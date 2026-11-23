import { Context } from '@expressive/mvc';

import type { Node as RenderNode } from '../node/vnode';
import { attach, batched, fragment } from './commits';
import { range } from './fiber';
import { resume } from './host';
import type { Container, Fiber } from './fiber';
import { unmountFiber } from './mount';
import { reconcile } from './reconcile';
import { consume, renderedAppearance } from '../core/appearance';
import { settle, suspend, unwait } from './suspense';
import { rootOf } from './host';
import type { Host } from './host';
import { within } from './host';
import { announce } from '../copies';

const roots = new WeakMap<Container, () => void>();
const passed: (() => void)[] = [];
let passiveRender = false;
let rendering: Fiber | undefined;
let depth = 0;

function render(node: RenderNode, container: Container, host: Host): () => void {
  roots.get(container)?.();
  container.replaceChildren();

  return mountRoot(node, container, host);
}

function hydrate(node: RenderNode, container: Container, host: Host): () => void {
  const { hydration } = host;

  if (!hydration) return render(node, container, host);

  roots.get(container)?.();

  return batched(() => hydration.hydrating(container, () => mountRoot(node, container, host)));
}

function mountRoot(node: RenderNode, container: Container, host: Host): () => void {
  announce();

  const context = new Context(Context.root);
  const root = rootOf(host, container);
  const fiber = within(root, () => range('fragment', container, null, context));

  try {
    within(root, () => pass(() => reconcile(fiber, node, context, undefined, undefined)));
  } catch (error) {
    unmountFiber(fiber);
    context.pop();
    throw error;
  }

  let active = true;
  const unmount = () => {
    if (!active) return;
    active = false;
    unmountFiber(fiber);
    context.pop();
    roots.delete(container);
  };

  roots.set(container, unmount);
  return unmount;
}

function pass<T>(work: () => T): T {
  depth++;

  try {
    return work();
  } finally {
    if (!--depth) {
      settle();
      passed.splice(0).forEach((run) => run());
    }
  }
}

/** Run `run` once the current render pass ends - now, outside one. It must not throw: a throw replaces the pass's own error. */
function afterPass(run: () => void) {
  if (depth) passed.push(run);
  else run();
}

function attempt(fiber: Fiber, passive: boolean, render: () => RenderNode): true | PromiseLike<unknown> | void {
  const previous = passiveRender;
  const scope = fiber.scope!;
  const probed = scope.probed;
  const empty = !fiber.children.length;

  scope.probed = undefined;
  passiveRender ||= passive;

  if (passive && !depth && empty && !fiber.stash && !fiber.dehydrated)
    fiber.staging ||= fragment(fiber.root!);

  const dehydrated = fiber.dehydrated;
  fiber.dehydrated = undefined;

  const run = () => within(fiber.root!, () => pass(() => dehydrated ? batched(() => resume(fiber, update)) : update()));
  const update = () => {
    const parent = rendering;
    rendering = fiber.type ? fiber : parent;

    try {
      const output = probed ? probed.output as RenderNode : consume(fiber, render);
      reconcile(fiber, output, scope.context, fiber.boundary, renderedAppearance(fiber));

      if (fiber.staging) {
        fiber.end.parentNode!.insertBefore(fiber.staging, fiber.end);
        attach(fiber.staging);
        fiber.staging = undefined;
      }

      if (!fiber.recovering) unwait(fiber);
      fiber.retried = undefined;
      return true;
    } catch (thrown) {
      return suspend(fiber, thrown, passive, empty);
    } finally {
      rendering = parent;
    }
  };

  try {
    return passive ? batched(run) : run();
  } finally {
    passiveRender = previous;
  }
}

export { afterPass, attempt, depth, hydrate, mountRoot, pass, passiveRender, render, rendering };
