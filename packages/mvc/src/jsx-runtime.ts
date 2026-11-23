import type { Component } from './component';

/**
 * Per-adapter interpretation manifest. Each adapter augments this interface to
 * declare how it renders; the first member is `node` - the element type produced
 * by `Component.render` (surfaced as `Component.Node`) - alongside `intrinsics`,
 * the host's tag map (surfaced as `JSX.IntrinsicElements`), `elementClass`,
 * the instance a class must construct to render as an element, and optionally
 * `element`, further element types the host renders (joined into
 * `JSX.ElementType`).
 *
 * ```ts
 * declare module '@expressive/mvc/jsx-runtime' {
 *   interface Host {
 *     node: React.ReactNode;
 *     intrinsics: React.JSX.IntrinsicElements;
 *     elementClass: React.Component<any, any>;
 *   }
 * }
 * ```
 *
 * Only one adapter is expected per compilation; two augmenting the same member
 * with different types in the same build would conflict - by design.
 */
export interface Host { }

/**
 * Host runtime an adapter (e.g. `@expressive/react`) registers to replace the default {@link Element}.
 *
 * One host per build - a second registration with a different runtime throws.
 * Without one, element creation and introspection use the default element.
 * Members are ambient host capabilities callable outside render; hook-shaped ones live with the adapter.
 */
export interface HostRuntime {
  childrenOf(children: unknown): Component.Node[];
  isElement(node: unknown): boolean;
  jsx(type: unknown, props: object, key?: unknown): Component.Node;
  jsxDEV?(type: unknown, props: object, key?: unknown, isStatic?: boolean, source?: object, self?: unknown): Component.Node;
  jsxs(type: unknown, props: object, key?: unknown): Component.Node;
  propsOf(node: unknown): Record<string, unknown>;
  typeOf(node: unknown): unknown;
  Fragment: unknown;
}

/**
 * Element the JSX entries create when no host is registered.
 *
 * `source` is set only by `jsxDEV` - the compiler's location, or `{}` without one - so it marks a dev element.
 */
export interface Element<P = any> {
  readonly type: unknown;
  readonly props: P;
  readonly key?: string | number | null;
  readonly source?: object;
}

/**
 * Agnostic Fragment sentinel. The runtime entries translate it to the host's
 * Fragment on element creation; `typeOf` translates back, so identity checks
 * against this value hold for fragments from either pragma.
 */
export const Fragment = Symbol.for('@expressive/mvc.Fragment');

/** Host-side: every class declared an element - see `element.ts`. */
export { elements } from './element';

/** Host-side: how `Context.get` resolves outside an origin - see `context.ts`. */
export { resolver } from './context';
export type { Renderable } from './element';

/** Host-side: owner and key of a bound method - see `model.ts`. */
export { methodOf } from './model';

const ELEMENT = Symbol.for('@expressive/mvc.element');

let created: ((element: Element) => void) | undefined;

/**
 * Host-side: call `hook` with each default element as it is created. Returns the previous hook.
 *
 * A host chains by calling the previous hook from its own.
 */
export function onElement(hook: (element: Element) => void) {
  const previous = created;
  created = hook;
  return previous;
}

function element(type: unknown, props: object, key?: unknown, source?: object): Element {
  const node = { [ELEMENT]: true, type, props: props || {}, key } as { -readonly [K in keyof Element]: Element[K] };

  if (source) node.source = source;
  if (created) created(node);

  return node;
}

function isDefault(node: unknown): node is Element {
  return !!node && typeof node == 'object' && (node as any)[ELEMENT] === true;
}

function flatten(children: unknown) {
  const output: Component.Node[] = [];

  function add(child: unknown) {
    if (Array.isArray(child)) child.forEach(add);
    else if (child != null && typeof child != 'boolean') output.push(child as Component.Node);
  }

  add(children);
  return output;
}

const DEFAULT = {
  childrenOf: flatten,
  isElement: isDefault,
  jsx: element,
  jsxs: element,
  jsxDEV: (type, props, key, _isStatic, source) => element(type, props, key, source || {}),
  propsOf: (node) => isDefault(node) ? node.props : {},
  typeOf: (node) => isDefault(node) ? node.type : undefined,
  Fragment
} as Required<HostRuntime>;

const HOST: HostRuntime = { ...DEFAULT };

let registered: HostRuntime | undefined;

/**
 * Register the host runtime. Idempotent for the same runtime - re-registering
 * picks up members added since (e.g. an optional dev seam). A runtime without
 * `jsxDEV` gets its `jsx`/`jsxs` for dev builds.
 */
export function host(runtime: HostRuntime) {
  if (registered && registered !== runtime)
    throw new Error(
      'A different JSX host is already registered for @expressive/mvc. ' +
      'Only one host adapter may be active per build.'
    );

  registered = runtime;
  Object.assign(HOST, runtime, { jsxDEV: runtime.jsxDEV });
}

/** Translate the agnostic Fragment sentinel to the host's Fragment. */
function hostType(type: unknown): unknown {
  return type === Fragment ? HOST.Fragment : type;
}

export function jsx(type: unknown, props: object, key?: unknown): Component.Node {
  return HOST.jsx(hostType(type), props, key);
}

export function jsxs(type: unknown, props: object, key?: unknown): Component.Node {
  return HOST.jsxs(hostType(type), props, key);
}

/** Dev-transpiled element creation. A host without a `jsxDEV` of its own falls
 * back to its production entries. */
export function jsxDEV(
  type: unknown,
  props: object,
  key?: unknown,
  isStatic?: boolean,
  source?: object,
  self?: unknown
): Component.Node {
  return HOST.jsxDEV
    ? HOST.jsxDEV(hostType(type), props, key, isStatic, source, self)
    : isStatic
      ? jsxs(type, props, key)
      : jsx(type, props, key);
}

/** Flatten `children` to an array of nodes, per the host's semantics. */
export function childrenOf(children: unknown): Component.Node[] {
  return HOST.childrenOf(children);
}

/** Is `node` a host element? */
export function isElement(node: unknown): boolean {
  return HOST.isElement(node);
}

/** Element type of `node`; host Fragments surface as the agnostic `Fragment`. */
export function typeOf(node: unknown): unknown {
  const type = HOST.typeOf(node);
  return type === HOST.Fragment ? Fragment : type;
}

/** Props carried by element `node`. */
export function propsOf(node: unknown): Record<string, unknown> {
  return HOST.propsOf(node);
}


export declare namespace JSX {
  type Element = Component.Node;
  type ElementType =
    | keyof IntrinsicElements
    | ((props: any) => Component.Node)
    | (new (...args: any[]) => Host extends { elementClass: infer I } ? I : ElementClass)
    | (Host extends { element: infer T } ? T : never);
  /**
   * Class instance contract when no host declares `elementClass`. Gates on the
   * `render` contract alone - requiring full
   * `Component` assignability trips contravariance on `props` members (e.g.
   * the `is` callback narrows per subclass), rejecting every subclass.
   */
  interface ElementClass { render(props?: any): Component.Node }
  interface ElementAttributesProperty { props: {} }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number | null }
  /**
   * Host tag manifest, via the {@link Host} seam. Resolves to `{}` until an
   * adapter augments `Host` with `intrinsics` - agnostic code is
   * components-only by design, since it cannot know what tags a host renders.
   */
  type IntrinsicElements =
    Host extends { intrinsics: infer T extends object } ? T : {};
}
