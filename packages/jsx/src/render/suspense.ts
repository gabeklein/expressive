import { isThenable } from '../node/kind';
import { attach, fragment } from './commits';
import { move, moveRange, range } from './fiber';
import { hydrationOf } from './host';
import type { Boundary, Fiber } from './fiber';
import { unmountFiber } from './mount';
import { place } from './portal';
import { reconcile } from './reconcile';
import { depth, pass } from './render';
import { release, schedule, transition } from '../core/scheduler';
import { activeRoot, within } from './host';

const dirty = new Set<Boundary>();
const stashes = new WeakMap<globalThis.Node, Fiber>();
let holding: { thrown: unknown; fiber?: Fiber; handler?: Boundary } | undefined;
let settling = false;
const REDIRECT = Symbol.for('@expressive/router#redirect');
const HOLD = Symbol.for('@expressive/router#hold-redirect');

type Branded = { [key: symbol]: unknown };

function park(fiber: Fiber) {
  move(fiber, fragment(activeRoot()), null);
}

function hold(fiber: Fiber, error: unknown) {
  if (!holding || error !== holding.thrown) return false;

  park(fiber);
  holding.fiber = fiber;
  return true;
}

function gather(error: unknown, next: Fiber[], old: Fiber[]) {
  if (!holding || error !== holding.thrown) return;

  for (const fiber of next) if (!old.includes(fiber)) park(fiber);
  if (holding.fiber) next.push(holding.fiber);
  holding.fiber = undefined;
}

/** The node `parent` stands in for - the live parent when content mounts into a suspended stash. */
function hostOf(parent: globalThis.Node) {
  let host = parent;

  for (let owner = stashes.get(host); owner; owner = stashes.get(host))
    host = owner.end.parentNode!;

  return host;
}

function wait(fiber: Fiber, boundary: Boundary) {
  if (fiber.waitingOn !== boundary) unwait(fiber);

  fiber.waitingOn = boundary;
  (boundary.waiting ||= new Set()).add(fiber);
  dirty.add(boundary);
}

function unwait(fiber: Fiber) {
  const boundary = fiber.waitingOn;

  if (!boundary) return;

  fiber.waitingOn = undefined;
  boundary.waiting!.delete(fiber);
  if (!boundary.owner!.dead) dirty.add(boundary);
}

function settle() {
  if (settling) return;
  settling = true;

  try {
    for (const boundary of dirty) {
      dirty.delete(boundary);

      const owner = boundary.owner!;
      const waiting = boundary.waiting!.size > 0;

      if (!owner.dead && waiting != !!owner.stash)
        waiting ? hide(owner, boundary) : reveal(owner);
    }
  } finally {
    settling = false;
  }
}

function hide(owner: Fiber, boundary: Boundary) {
  const stash = fragment(owner.root!);

  for (const child of owner.children) move(child, stash, null);

  owner.portals = portals(owner, []).map((portal) => {
    const content = fragment(portal.root!);
    moveRange(portal.portalStart!, portal.portalEnd!, content);
    return [portal, content];
  });

  stashes.set(stash, owner);

  owner.stash = stash;
  owner.placeholder = within(owner.root!, () => range('fragment', owner.end.parentNode!, owner.end, owner.childContext!));
  draw(owner, boundary);
}

function draw(owner: Fiber, boundary: Boundary) {
  if (owner.root!.waiting) return;

  within(owner.root!, () => reconcile(owner.placeholder!, boundary.fallback!(), owner.childContext!, boundary.parent));
}

function reveal(owner: Fiber) {
  unmountFiber(owner.placeholder!);
  owner.end.parentNode!.insertBefore(owner.stash!, owner.end);
  attach(owner.stash!);

  for (const [portal, content] of owner.portals!)
    if (!portal.dead) {
      place(portal, content);
      attach(content);
    }

  owner.portals = undefined;
  owner.placeholder = undefined;
  owner.stash = undefined;
}

function portals(fiber: Fiber, found: Fiber[]) {
  for (const child of fiber.children) {
    if (child.kind == 'portal') found.push(child);
    portals(child, found);
  }

  return found;
}

function suspend(fiber: Fiber, thrown: unknown, passive: boolean, empty: boolean) {
  let boundary = fiber.boundary;

  for (let above = boundary; above; above = above.parent)
    if (above.fallback?.() !== false) {
      boundary = above;
      break;
    }

  if (isThenable(thrown)) {
    const kept = !fiber.children.length && hydrationOf().keep(fiber.start, fiber.end);

    if (kept) fiber.dehydrated = true;
    else if (!boundary) throw thrown;
    if (passive && empty && depth > 1) {
      if (holding?.thrown !== thrown) holding = { thrown };
      throw thrown;
    }

    holding = undefined;
    if (!passive && !kept) wait(fiber, boundary!);

    const scope = fiber.scope!;
    let held = scope.holds;

    scope.holds = undefined;

    const waiting = fiber.root?.waiting;
    let done: (() => void) | undefined;
    const entry = waiting && new Promise<void>((resolve) => done = resolve);
    const clear = () => {
      waiting?.delete(entry!);
      done?.();
      fiber.suspended!.delete(clear);
      release(held);
      held = undefined;
    };

    (fiber.suspended ||= new Set()).add(clear);
    waiting?.add(entry!);

    const resume = (retry: () => void) => {
      fiber.suspended!.delete(clear);
      if (!scope.active) return clear();
      if (held) (scope.holds ||= []).push(...held);
      held = undefined;
      if (waiting) setTimeout(() => {
        waiting.delete(entry!);
        done!();
        if (scope.active) retry();
      });
      else retry();
    };

    thrown.then(
      () => resume(() => passive ? transition(() => schedule(scope)) : schedule(scope)),
      (error) => resume(() => pass(() => recover(fiber, error, fiber.boundary)))
    );
    return thrown;
  }

  return recover(fiber, thrown, fiber.boundary, passive, empty);
}

function descendants(fiber: Fiber): number {
  return fiber.children.reduce((count, child) => count + 1 + descendants(child), 0);
}

function recover(fiber: Fiber, thrown: unknown, boundary: Boundary | undefined, passive = false, empty = false): PromiseLike<unknown> | void {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown));
  const propagated = holding?.thrown === thrown ? holding!.handler : undefined;

  if (propagated) {
    boundary = propagated;
    holding = undefined;
  }
  else if (fiber.root?.waiting) {
    const reached = descendants(fiber);

    if (fiber.retried && reached <= fiber.reached!) boundary = fiber.handled!.parent;

    fiber.reached = reached;
    fiber.retried = undefined;
  }

  while (boundary && !boundary.catch) boundary = boundary.parent;

  if (!boundary) throw error;

  const handler = boundary;
  let heldCatch = passive && redirects(error, handler);

  if (heldCatch && depth > 1) {
    if (empty) {
      holding = { thrown, handler };
      throw thrown;
    }

    heldCatch = false;
  }

  const token = {};

  if (!heldCatch) wait(fiber, handler);
  fiber.recovering = token;

  fiber.handled = handler;

  const caught = Promise.resolve(handler.catch!(error));
  const waiting = fiber.root?.waiting;
  const done = () => waiting!.delete(caught);

  if (waiting) {
    waiting.add(caught);
    caught.then(done, done);
  }

  if (!heldCatch && handler.owner!.placeholder && !handler.owner!.dead) draw(handler.owner!, handler);

  const scope = fiber.scope!;
  let held = heldCatch ? scope.holds : undefined;
  const clear = () => {
    fiber.suspended!.delete(clear);
    release(held);
    held = undefined;
  };

  if (heldCatch) scope.holds = undefined;
  (fiber.suspended ||= new Set()).add(clear);

  caught.then(
    () => {
      if (fiber.recovering !== token) return clear();
      fiber.recovering = undefined;
      if (!scope.active || fiber.retried) return clear();
      fiber.retried = true;
      fiber.suspended!.delete(clear);
      if (held) (scope.holds ||= []).push(...held);
      heldCatch ? transition(() => schedule(scope)) : schedule(scope);
    },
    (next) => {
      clear();
      if (fiber.recovering === token && scope.active) pass(() => recover(fiber, next, handler.parent));
    }
  );

  if (heldCatch) return caught;
}

function redirects(error: Error, handler: Boundary) {
  return !!(error as Error & Branded)[REDIRECT] && !!(handler.owner!.instance as Branded | undefined)?.[HOLD];
}


export { gather, hold, hostOf, settle, suspend, unwait };
