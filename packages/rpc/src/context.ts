import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { Context, Model } from "@expressive/mvc";
import { resolver } from "@expressive/mvc/host";

import { bodyOf, capped, originOf, parsed } from "./body";
import { refusal, toReply, withHeaders, type Source } from "./reply";

interface Layer {
  prefix: string;
  context: Context;
  parent?: Layer;
  children: Map<string, Layer>;
  seat?: Entry;
  calls: number;
  pooled: number;
}

interface Entry {
  Type: Owned;
  layer: Layer;
  context: Context;
  instance: Model;
  ready: Promise<void>;
  remove(): void;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface Exchange {
  origin: Request;
  request: Request;
  ctx: ExecutionCtx;
  held: Set<Entry>;
  done: (() => void)[];
  open: number;
  left: Promise<void>;
  leave(): void;
}

interface Stage {
  exchange: Exchange;
  params: Record<string, string>;
  headers: Headers;
  early: string[];
  decided: boolean;
  after?: Promise<void>;
  pending?: Promise<unknown>;
  next(): Promise<unknown>;
  ready(): Promise<void>;
  refuse(error: unknown): Promise<void>;
  decide(reply: unknown): void;
}

interface Frame {
  exchange: Exchange;
  layer: Layer;
  params?: Record<string, string>;
  stage?: Stage;
  capture?: Model[];
}

type Owned = Model.Type & { ttl?: number };

export type Seat = Owned & { key?(): string | number | undefined };

export type Gate = () => unknown;

let TTL = 0;
let installed = false;

const store = new AsyncLocalStorage<Frame>();
const SEATED = new WeakSet<Owned>();
const GATED = new WeakSet<Model>();
const FAILED = new WeakMap<Model, unknown>();
let top: Layer | undefined;
let built: ((instance: Model) => void) | undefined;

function frame(): Frame {
  const frame = store.getStore();
  if (!frame) throw new Error("Server Model resolves only within a request.");
  return frame;
}

function newLayer(prefix: string, parent?: Layer): Layer {
  const context = parent ? scope(parent).push() : Context.root.push(Current);
  return { prefix, context, parent, children: new Map(), calls: 0, pooled: 0 };
}

function scope(layer: Layer): Context {
  return layer.seat ? layer.seat.context : layer.context;
}

function root(): Layer {
  return (top ??= newLayer(""));
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("base64url").slice(0, 22);
}

function keyOf(Seat: Seat): string | undefined {
  const key = Seat.key?.();

  if (key === undefined) return;
  if (typeof key != "string" && typeof key != "number")
    throw new Error(`${Seat.name}.key() returned ${key} - a key is a string, a number or undefined.`);

  return String(key);
}

function enter(parent: Layer, segment?: string, Seat?: Seat): Layer {
  let prefix = segment === undefined ? parent.prefix : hash(`${parent.prefix}/${segment}`);
  const key = Seat && keyOf(Seat);

  if (key !== undefined) prefix = hash(`${prefix}#${key}`);

  let layer = prefix === parent.prefix ? parent : parent.children.get(prefix);

  if (!layer) {
    layer = newLayer(prefix, parent);
    parent.children.set(prefix, layer);
  }

  if (Seat) seat(layer, Seat);

  return layer;
}

function seat(layer: Layer, Seat: Seat) {
  if (layer.seat?.Type !== Seat) {
    if (layer.seat) evict(layer, true);
    layer.seat = create(Seat, layer);
  }

  hold(frame().exchange.held, layer.seat);
}

const isEmpty = (layer: Layer) => !layer.calls && !layer.pooled && !layer.seat && !layer.children.size;

function prune(layer: Layer) {
  let at = layer;

  while (at.parent && at.parent.children.get(at.prefix) === at && isEmpty(at)) {
    at.context.pop();
    at.parent.children.delete(at.prefix);
    at = at.parent;
  }
}

function drop(entry: Entry) {
  if (entry.layer.seat === entry) evict(entry.layer);
}

function evict(layer: Layer, keep = false) {
  const entry = layer.seat;

  layer.seat = undefined;
  layer.children.forEach(child => evict(child));

  if (entry) {
    clearTimeout(entry.timer);
    entry.remove();
    entry.context.pop();
  }

  if (keep || !layer.parent) return;

  layer.context.pop();
  layer.parent.children.delete(layer.prefix);
}

function release(entry: Entry) {
  if (--entry.refs) return;

  const ttl = entry.Type.ttl ?? TTL;

  if (ttl <= 0) return drop(entry);

  entry.timer = setTimeout(() => drop(entry), ttl * 1000);
  entry.timer.unref();
}

const isSeat = (guard: Seat | Gate): guard is Seat => guard.prototype instanceof Model;

async function settle(model: Model) {
  try {
    await model.set();
  } catch (error) {
    if (FAILED.has(model)) throw FAILED.get(model);
  }
}

async function settleAll(built: Model[]) {
  for (let done = 0; done < built.length; ) {
    const batch = built.slice(done);

    done = built.length;
    await Promise.all(batch.map(settle));
  }
}

function ungate(layer: Layer, built: Model[]) {
  const shared = layer.parent!;

  layer.children.forEach(child => evict(child));
  built.forEach(model => model.set(null));
  layer.context.pop();
  shared.calls--;
  prune(shared);
}

const rethrow = (error: unknown): never => {
  throw error;
};

function open(request: Request): Exchange {
  const origin = originOf(request);
  const signal = origin.signal;
  let leave!: () => void;
  const left = new Promise<void>(resolve => (leave = resolve));

  if (signal.aborted) leave();
  else signal.addEventListener("abort", leave, { once: true });

  return { origin, request: bodyOf(origin), ctx: ctxOf(origin), held: new Set(), done: [], open: 0, left, leave };
}

function close(exchange: Exchange) {
  if (--exchange.open) return;

  exchange.held.forEach(release);
  exchange.done.reverse().forEach(done => done());

  const late = new Headers();

  outgoing.get(exchange.origin)?.flush.forEach(flush => flush(late));

  if (late.has("set-cookie")) console.warn("Cookies set with no reply left to carry them were dropped.");
}

/**
 * Run `run` in `request`'s scope, through the layers `segments` walks - seating each one's Model
 * class, or running its function gate with the rest of the walk as its `next`.
 *
 * Within another scope of the same request, shares it. A throw from a seat, a gate or `run` resolves
 * with `fail`'s reply, by default rejecting. A gate's answer - `send`, a returned `Response` or
 * function - resolves with that `Response` instead of `run`'s value.
 */
export async function within<T>(request: Request, segments: string[], run: () => T, seats: (Seat | Gate | undefined)[] = [], fail: (error: unknown) => Awaited<T> | Promise<Awaited<T>> = rethrow, params?: Record<string, string>, depths: Record<string, string>[] = []): Promise<Awaited<T>> {
  const parent = store.getStore();
  const nested = parent?.exchange.origin === originOf(request);
  const exchange = nested ? parent!.exchange : open(request);
  const frame: Frame = { exchange, layer: root(), params };

  exchange.open++;

  try {
    return await store.run(frame, () => walk(frame, [undefined, ...segments], 0, run, seats, fail, depths)) as Awaited<T>;
  } finally {
    if (!nested) exchange.leave();
    close(exchange);
  }
}

async function walk<T>(frame: Frame, steps: (string | undefined)[], from: number, run: () => T, seats: (Seat | Gate | undefined)[], fail: (error: unknown) => unknown, depths: Record<string, string>[]): Promise<unknown> {
  const { exchange } = frame;
  const join = (reply: unknown) => (reply instanceof Response ? withHeaders(reply, headersOf(exchange.origin)) : reply);
  let gate: { at: number; fn: Gate } | undefined;

  try {
    for (let i = from; i < steps.length; i++) {
      const guard = seats[i];

      if (guard && !isSeat(guard)) {
        frame.layer = enter(frame.layer, steps[i]);
        gate = { at: i + 1, fn: guard };
        break;
      }

      frame.layer = enter(frame.layer, steps[i], guard);
      await frame.layer.seat?.ready;
    }

    if (!gate) {
      const { layer } = frame;

      layer.calls++;
      exchange.done.push(() => {
        layer.calls--;
        prune(layer);
      });

      return join(await run());
    }
  } catch (error) {
    return join(await fail(error));
  }

  const { at, fn } = gate;

  return join(await stage(frame, fn, below => walk(below, steps, at, run, seats, fail, depths), depths[at - 1] ?? EMPTY, fail, true));
}

const noop = () => {};
const TRACKED = new WeakSet<ReadableStream>();

function stage<T>(parent: Frame, run: () => unknown, below: ((frame: Frame) => Promise<T>) | undefined, params: Record<string, string>, fail: (error: unknown) => T | Promise<T>, gate: boolean): Promise<T> {
  const { exchange } = parent;
  const shared = parent.layer;
  const layer = newLayer(shared.prefix, shared);
  const built: Model[] = [];
  const lower: Frame = { exchange, layer, params: parent.params };
  let resolve!: (reply: T) => void;
  let reject!: (error: unknown) => void;
  let final: unknown;
  let passed: unknown;
  let refusing: Promise<void> | undefined;

  shared.calls++;
  exchange.done.push(() => ungate(layer, built));
  exchange.open++;

  const decided = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));

  const discard = (reply: unknown) => {
    const body = reply instanceof Response && reply.body;
    const sent = (final as Response | undefined)?.body;

    if (!body || body === sent) return;

    const cancel = () => void body.cancel().catch(noop);

    if (sent && TRACKED.has(sent)) exchange.done.push(cancel);
    else cancel();
  };

  const down = (): Promise<unknown> => {
    exchange.open++;

    return store.run(lower, async () => below!(lower))
      .then(
        reply => {
          passed = reply;
          if (st.decided) discard(reply);
          return reply;
        },
        fail,
      )
      .finally(() => close(exchange));
  };

  const st: Stage = {
    exchange,
    params,
    headers: new Headers(),
    early: [],
    decided: false,
    ready: () => settleAll(built),
    refuse(error) {
      return (refusing ??= (async () => {
        try {
          st.decide(await fail(error));
        } catch (thrown) {
          st.decided = true;
          reject(thrown);
        }
      })());
    },
    next() {
      if (!below || !gate) throw new Error("next() runs only in a gate - a route or call has nothing below it.");
      if (st.pending) throw new Error("next() runs once per gate.");

      const early = new Headers();

      outgoing.get(exchange.origin)?.flush.forEach(flush => flush(early));
      st.early = early.getSetCookie();
      st.pending = st.ready().then(down);
      st.pending.catch(noop);

      return st.pending;
    },
    decide(reply) {
      if (st.decided) return discard(reply);

      st.decided = true;

      if (reply instanceof Response) {
        const extra = new Headers();
        const named = (cookie: string) => cookie.slice(0, cookie.indexOf("="));
        const below = new Set(reply.headers.getSetCookie().map(named));

        st.early.forEach(cookie => below.has(named(cookie)) || extra.append("set-cookie", cookie));
        outgoing.get(exchange.origin)?.flush.forEach(flush => flush(st.headers));
        st.headers.forEach((value, name) => (name === "set-cookie" ? extra.append(name, value) : extra.set(name, value)));
        reply = withHeaders(reply, extra);
      }

      final = reply;
      discard(passed);
      resolve(reply as T);
    },
  };

  const frame: Frame = { exchange, layer, stage: st, capture: below && !gate ? undefined : built };

  const answer = async (result: unknown, handler = true): Promise<void> => {
    if (result instanceof Response) return st.decide(result);

    if (typeof result == "function") {
      if (!handler) throw new TypeError("A fetch handler returned a function - return a Response.");

      const { request, origin, ctx } = exchange;

      return answer(await result(request, bound.get(origin)?.env ?? {}, ctx), false);
    }

    if (below) return st.decide(await (st.pending ?? down()));

    st.decide(toReply(result === undefined ? [] : [200, result], source => track(source, frame)));
  };

  st.after = (async () => {
    try {
      const result = await store.run(frame, run);

      if (st.decided) {
        if (result !== undefined) console.warn("A value returned after the reply was decided is ignored.");
        return;
      }

      await st.ready();
      await (refusing ?? store.run(frame, () => answer(result)));
    } catch (error) {
      if (refusing) return void (await refusing);
      if (st.decided) return void console.error(error);

      await st.refuse(error);
    } finally {
      close(exchange);
    }
  })();

  return decided;
}

/**
 * Run a gate or route in the request's scope, resolving with its reply once decided.
 *
 * With `below`, `run` is a gate: `Current.get().next` runs `below`, and returning nothing passes.
 * Without, `run` is a route: its returned value is the body. `params` is what `Current.get().params`
 * reads in `run`. A throw answers its `HttpError` status, else a logged 500 - its message with `dev`.
 * Throws outside a request.
 */
export function layer(run: () => unknown, below?: () => Promise<Response>, params: Record<string, string> = EMPTY, dev = false): Promise<Response> {
  return stage(frame(), run, below && (() => below()), params, error => refusal(error, dev), true);
}

export function pass<T>(run: () => T): Promise<Awaited<T> | undefined> {
  return stage(frame(), run, async () => undefined, {}, rethrow, false) as Promise<Awaited<T> | undefined>;
}

function track(source: Source, frame: Frame): ReadableStream<Uint8Array> {
  const { exchange } = frame;
  const encoder = new TextEncoder();
  let cancelled = false;
  const end = () => close(exchange);

  exchange.open++;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await store.run(frame, () => source.next());

        if (cancelled) return;

        if (done) {
          end();
          controller.close();
        } else controller.enqueue(typeof value == "string" ? encoder.encode(value) : value);
      } catch (error) {
        if (cancelled) return;
        end();
        console.error(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;

      try {
        await store.run(frame, () => source.stop(reason));
      } finally {
        end();
      }
    },
  }, { highWaterMark: 0 });

  TRACKED.add(stream);
  return stream;
}

function create(Type: Owned, layer: Layer): Entry {
  if (!SEATED.has(Type)) {
    SEATED.add(Type);
    Type.on({ catch: (error, kind) => (kind == "setup" ? undefined : error) });
  }

  const context = layer.context.push(Type);
  const instance = context.get(Type)!;

  const remove = layer.context.add(instance, true);
  const ready = Promise.resolve(instance.get(() => {}));
  const entry: Entry = { Type, layer, context, instance, ready, remove, refs: 0 };

  built?.(instance);
  instance.set(null, () => drop(entry));

  return entry;
}

function hold(held: Set<Entry>, entry: Entry) {
  if (held.has(entry)) return;

  held.add(entry);
  entry.refs++;
  clearTimeout(entry.timer);
}

let detached: Context | undefined;

function detachedContext(): Context {
  if (!detached) {
    detached = Context.root.push(Current);
  }

  return detached;
}

export function construct(Type: Model.Type, off = false): { instance: Model; drop(): void; current(): boolean } {
  const layer = off ? undefined : frame().layer;
  const context = (layer ? scope(layer) : detachedContext()).push(Type);
  const instance = context.get(Type)!;

  built?.(instance);

  if (layer) {
    layer.pooled++;
    instance.set(null, () => {
      layer.pooled--;
      prune(layer);
    });
  }

  return {
    instance,
    drop: () => void (instance.get(null) || context.pop()),
    current: () => !instance.get(null) && (!layer || frame().layer === layer),
  };
}

export function seated(): Model | undefined {
  return frame().layer.seat?.instance;
}

export function onBuild(hook: (instance: Model) => void) {
  built = hook;
}

let watching = false;

function watch() {
  if (watching) return;
  watching = true;

  Model.on({
    setup() {
      const frame = store.getStore();

      if (!frame?.capture) return;

      frame.capture.push(this);
      frame.layer.context.add(this, true);
      GATED.add(this);
    },
    catch(error, kind) {
      if (kind != "setup" || !GATED.has(this)) return error;

      FAILED.set(this, error);
    },
  });
}

/**
 * Route server `get()` through the call's layer. `ttl` is how long a seat outlives its last call by
 * default - 0, since a gate's state derives from each request.
 */
export function install({ ttl = 0 }: { ttl?: number } = {}) {
  TTL = ttl;
  installed = true;
  watch();

  const previous = resolver((Type, compute) => {
    if (!Type && !store.getStore()) return previous(Type, compute);
    return compute(scope(frame().layer));
  });
}

/** Install with defaults unless a host already has - for servers the app runs itself. */
export function ensureInstalled() {
  if (!installed) install();
}

function parseCookies(header = ""): Record<string, string> {
  const pairs = header.split(";").filter(Boolean).map(pair => {
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = decodeURIComponent(pair.slice(at + 1).trim());

    return [name, value];
  });

  return Object.fromEntries(pairs);
}

interface Outgoing {
  headers: Headers;
  flush: Set<(into: Headers) => void>;
}

const outgoing = new WeakMap<Request, Outgoing>();

/**
 * Bindings the host hands a server's `fetch` as `env`, as `Current.env` returns them.
 *
 * Extend it to type them: `declare module "@expressive/rpc" { interface Env { API_KEY: string } }`.
 */
export interface Env {}

/** What `Current.get().ctx` gives: the host's members, a stand-in's where it lacks them. */
export interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props: Record<string, unknown>;
}

const bound = new WeakMap<Request, { env: Env; ctx?: Partial<ExecutionCtx> }>();

/** Give the request's scope the `env` and `ctx` its host passed - `ctx` members it lacks get stand-ins. */
export function bind(request: Request, env: Env, ctx?: Partial<ExecutionCtx>): void {
  bound.set(originOf(request), { env, ctx });
}

function ctxOf(request: Request): ExecutionCtx {
  const host = bound.get(request)?.ctx ?? {};

  return {
    waitUntil: host.waitUntil ? promise => host.waitUntil!(promise) : promise => void promise.catch(error => console.error("waitUntil:", error)),
    passThroughOnException: host.passThroughOnException ? () => host.passThroughOnException!() : () => {},
    props: host.props ?? {},
  };
}

/** The request of the scope in progress, if any - the one its host passed. */
export function active(): Request | undefined {
  return store.getStore()?.exchange.origin;
}

/** The request's reply-to-be: headers to add, and cookie flushes into the reply being decided. */
export function outgoingOf(request = frame().exchange.origin): Outgoing {
  let out = outgoing.get(request);

  if (!out) outgoing.set(request, (out = { headers: new Headers(), flush: new Set() }));

  return out;
}

/** What the calls on `request` asked to add to its reply since last taken. */
export function headersOf(request: Request): Headers | undefined {
  const out = outgoing.get(request);

  if (!out) return;

  const { headers } = out;

  out.flush.forEach(flush => flush(headers));
  out.headers = new Headers();

  return headers;
}

const readOnly = () => {
  throw new Error("Current is read-only.");
};

function staged(verb: string): Stage {
  const { stage } = frame();

  if (!stage) throw new Error(`${verb} belongs to a gate or route - a call answers with its return value.`);

  return stage;
}

const EMPTY: Record<string, string> = Object.freeze({}) as Record<string, string>;

class Decided extends Error {}

async function sendFrom(args: unknown[]): Promise<void> {
  const current = frame();
  const stage = staged("send()");
  const decided = () => {
    if (stage.decided) throw new Decided("This reply is already decided.");
  };

  decided();
  await stage.ready();
  decided();

  try {
    stage.decide(toReply(args, source => track(source, current)));
  } catch (error) {
    stage.refuse(error);
    throw error;
  }

  stage.exchange.ctx.waitUntil(stage.after!);
  await stage.exchange.left;
}

export class Current extends Model {
  /** The request, its body read through one cache: every read of any kind buffers it once. */
  get request(): Request {
    return frame().exchange.request;
  }
  set request(_: Request) {
    readOnly();
  }

  get url(): URL {
    return new URL(this.request.url);
  }
  set url(_: URL) {
    readOnly();
  }

  get cookies(): Record<string, string> {
    return parseCookies(this.request.headers.get("cookie") ?? undefined);
  }
  set cookies(_: Record<string, string>) {
    readOnly();
  }

  /** Bindings of the request in progress - the `env` its host passed, or a dev host's stand-ins. Empty where the host passes none. */
  get env(): Env {
    return bound.get(frame().exchange.origin)?.env ?? {};
  }
  set env(_: Env) {
    readOnly();
  }

  /** The matched route's params, decoded - a call's are its folder's. `{}` where the host gives none. */
  get params(): Record<string, string> {
    const { stage, params } = frame();

    return stage?.params ?? params ?? EMPTY;
  }
  set params(_: Record<string, string>) {
    readOnly();
  }

  /**
   * The host's execution context, with stand-ins where it lacks a member.
   *
   * The stand-in `waitUntil` runs the promise and logs a throw, `passThroughOnException` does nothing, `props` is `{}`.
   */
  get ctx(): ExecutionCtx {
    return frame().exchange.ctx;
  }
  set ctx(_: ExecutionCtx) {
    readOnly();
  }

  /**
   * In a gate: wait for the Models this gate activated, run everything below and resolve with that
   * reply - a throw below resolves its error reply. Once per gate.
   *
   * Calling it outside a gate throws; reading it never does.
   *
   * @example
   * const { next, send } = Current.get();
   * const reply = await next();
   * await send(reply);
   * await log(reply.status);
   */
  get next(): () => Promise<Response> {
    const stage = store.getStore()?.stage;

    return () => {
      if (!stage) throw new Error("next() runs only in a gate - a route or call has nothing below it.");
      return stage.next() as Promise<Response>;
    };
  }
  set next(_: () => Promise<Response>) {
    readOnly();
  }

  /**
   * The request body as JSON; `undefined` when empty.
   *
   * Rejects with `BadRequest` on invalid JSON or a type other than `application/json` or `+json`, `PayloadTooLarge` over 1 MB.
   */
  json(): Promise<unknown>;

  /**
   * The request body as JSON, passed through `check`. A throw from it rejects with `BadRequest`
   * carrying its message; an `HttpError` keeps its status.
   *
   * @example
   * const signup = await Current.get().json(Signup.parse);
   */
  json<T>(check: (value: unknown) => T): Promise<Awaited<T>>;

  json(check?: (value: unknown) => unknown): Promise<unknown> {
    const { exchange } = staged("json()");
    return parsed(exchange.request, check);
  }

  /** The request body as a string. Rejects with `PayloadTooLarge` over 1 MB. */
  text(): Promise<string> {
    const { exchange } = staged("text()");
    return capped(exchange.request);
  }

  /**
   * Set a header on this layer's reply.
   *
   * A `Response`'s own headers win. Throws once the reply is decided. For cookies, see `Cookies`.
   */
  setHeader(name: string, value: string): void {
    const { stage } = frame();

    if (stage?.decided) throw new Error(`Cannot set ${name} - this reply is already decided.`);

    const { headers } = stage ?? outgoingOf();

    if (name.toLowerCase() === "set-cookie") headers.append(name, value);
    else headers.set(name, value);
  }

  /**
   * Decide this layer's reply: a status, a `Response`, or a body - a plain object or array as JSON,
   * a string as text, bytes or a stream as is. Resolves once the reply has left; code after it is
   * after-work. A second `send`, or one in a call, throws.
   *
   * @example
   * await Current.get().send(200);
   * await notify();
   */
  send(body?: unknown): Promise<void>;

  /** Decide this layer's reply with `status`: `send(201, item)`. A body with 204, 304 or 1xx throws. */
  send(status: number, body?: unknown): Promise<void>;

  send(...args: unknown[]): Promise<void> {
    const sent = sendFrom(args);

    sent.catch(error => error instanceof Decided && console.error(error));
    return sent;
  }

  /** Sugar for `Current.get().send(...)`. */
  static send(body?: unknown): Promise<void>;

  /** Sugar for `Current.get().send(status, body)`. */
  static send(status: number, body?: unknown): Promise<void>;

  static send(...args: unknown[]): Promise<void> {
    return (Current.get() as Current).send(...(args as [number, unknown]));
  }
}
