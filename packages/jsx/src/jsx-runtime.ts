import type { Component } from '@expressive/mvc';
import type { Host } from '@expressive/mvc/jsx-runtime';

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

const ELEMENT = Symbol.for('@expressive/mvc.element');

interface Registry {
  host: HostRuntime;
  registered?: HostRuntime;
  created?: (element: Element) => void;
}

const REGISTRY = Symbol.for('@expressive/jsx.registry');
let local: Registry | undefined;

function registry(): Registry {
  return local ||= ((globalThis as any)[REGISTRY] ||= { host: { ...DEFAULT } });
}

/**
 * Host-side: call `hook` with each default element as it is created. Returns the previous hook.
 *
 * A host chains by calling the previous hook from its own.
 */
export function onElement(hook: (element: Element) => void) {
  const state = registry();
  const previous = state.created;

  state.created = hook;
  return previous;
}

const UNKNOWN = {};

function element(type: unknown, props: object, key?: unknown, source?: object): Element {
  const node = { [ELEMENT]: true, type, props: props || {}, key: key as Element['key'] } as { -readonly [K in keyof Element]: Element[K] };

  const { created } = registry();

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
  jsxDEV: (type, props, key, _isStatic, source) => element(type, props, key, source || UNKNOWN),
  propsOf: (node) => isDefault(node) ? node.props : {},
  typeOf: (node) => isDefault(node) ? node.type : undefined,
  Fragment
} as HostRuntime;

/**
 * Register the host runtime, shared by every copy of this package.
 *
 * A runtime with the registered `jsx` is the same host - re-registering picks up its members (e.g. an optional dev seam).
 * A runtime with another `jsx` throws. A runtime without `jsxDEV` gets its `jsx`/`jsxs` for dev builds.
 */
export function host(runtime: HostRuntime) {
  const state = registry();

  if (state.registered && state.registered.jsx !== runtime.jsx)
    throw new Error(
      'A different JSX host is already registered for @expressive/jsx. ' +
      'Only one host adapter may be active per build.'
    );

  state.registered = runtime;
  Object.assign(state.host, runtime, { jsxDEV: runtime.jsxDEV });
}

/** Translate the agnostic Fragment sentinel to the host's Fragment. */
function hostType(type: unknown): unknown {
  return type === Fragment ? registry().host.Fragment : type;
}

export function jsx(type: unknown, props: object, key?: unknown): Component.Node {
  return registry().host.jsx(hostType(type), props, key);
}

export function jsxs(type: unknown, props: object, key?: unknown): Component.Node {
  return registry().host.jsxs(hostType(type), props, key);
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
  const { host } = registry();

  return host.jsxDEV
    ? host.jsxDEV(hostType(type), props, key, isStatic, source, self)
    : isStatic
      ? jsxs(type, props, key)
      : jsx(type, props, key);
}

/** Flatten `children` to an array of nodes, per the host's semantics. */
export function childrenOf(children: unknown): Component.Node[] {
  return registry().host.childrenOf(children);
}

/** Is `node` a host element? */
export function isElement(node: unknown): boolean {
  return registry().host.isElement(node);
}

/** Element type of `node`; host Fragments surface as the agnostic `Fragment`. */
export function typeOf(node: unknown): unknown {
  const { host } = registry();
  const type = host.typeOf(node);

  return type === host.Fragment ? Fragment : type;
}

/** Props carried by element `node`. */
export function propsOf(node: unknown): Record<string, unknown> {
  return registry().host.propsOf(node);
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
