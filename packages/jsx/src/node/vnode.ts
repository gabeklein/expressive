import { Fragment as FRAGMENT, jsx, onElement } from '../jsx-runtime';
import type { Element as Created } from '../jsx-runtime';
import type { has, map } from '@expressive/mvc';
import type { JSX as Runtime } from '../jsx-runtime';

/**
 * Element type of a portal - `<Portal>` creates it, and hosts create or match it.
 *
 * A plain symbol, so a portal from another copy of this package is not recognized.
 */
const PORTAL = Symbol('@expressive/jsx.portal');
const ELEMENT = Symbol.for('@expressive/mvc.element');
const authors = new WeakMap<object, object>();
let author: object | undefined;
let hooked = false;

type Key = string | number | null | undefined;
type FunctionComponent<P = any> = (props: P) => Node;
interface ComponentInstance {
  render(props?: any): Node;
}
type ComponentType<P = any> = FunctionComponent<P> | (abstract new (...args: any[]) => object);

/** Anything a component can render: elements, instances, text, empties, arrays and collections. */
type Node =
  | VNode
  | ComponentInstance
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly Node[]
  | has.List<Node>
  | has.Pool<Node, any, any>
  | map.Managed<unknown, Node>;

/** An element - a tag, a component, `Fragment` or `PORTAL` - with its props and key. */
interface VNode<P = any> extends Created<P & { children?: Node }> {
  readonly type: string | symbol | ComponentType<P>;
}

/** Create an element through the registered JSX runtime - `jsx(type, props, key)` for host code. */
function vnode<P>(type: VNode<P>['type'], props: P, key?: unknown): VNode<P> {
  return jsx(type, props as object, key) as VNode<P>;
}

function authoring<T>(fiber: object, run: () => T) {
  const previous = author;

  if (!hooked) {
    const next = onElement((node) => {
      if (author) authors.set(node, author);
      if (next) next(node);
    });

    hooked = true;
  }

  author = fiber;

  try {
    return run();
  } finally {
    author = previous;
  }
}

function authorOf(value: unknown) {
  return isVNode(value) ? authors.get(value) : undefined;
}

/** Classic JSX factory - `key` comes off `props`, children land on `props.children`. */
function createElement(type: VNode['type'], props?: Record<string, unknown> | null, ...children: unknown[]): VNode {
  const { key, ...rest } = props || {};

  if (children.length) rest.children = children.length == 1 ? children[0] : children;

  return vnode(type, rest, key);
}

type JsxElement = Runtime.Element;
type JsxElementType = Runtime.ElementType;
type JsxElementClass = Runtime.ElementClass;
type JsxAttributesProperty = Runtime.ElementAttributesProperty;
type JsxChildrenAttribute = Runtime.ElementChildrenAttribute;
type JsxIntrinsicAttributes = Runtime.IntrinsicAttributes;
type JsxIntrinsicElements = Runtime.IntrinsicElements;

declare namespace createElement {
  namespace JSX {
    type Element = JsxElement;
    type ElementType = JsxElementType;
    interface ElementClass extends JsxElementClass {}
    interface ElementAttributesProperty extends JsxAttributesProperty {}
    interface ElementChildrenAttribute extends JsxChildrenAttribute {}
    interface IntrinsicAttributes extends JsxIntrinsicAttributes {}
    type IntrinsicElements = JsxIntrinsicElements;
  }
}

/** True for an element made by the JSX runtime, from any copy of this package. */
function isVNode(value: unknown): value is VNode {
  return !!value && typeof value == 'object' && (value as { [ELEMENT]?: true })[ELEMENT] === true;
}

/** Groups children without a wrapping element. */
const Fragment = FRAGMENT as unknown as (props: { children?: Node }) => Node;
/**
 * Render children into another element, keeping their context, ownership and boundaries.
 *
 * `into` is an `Element` or a `DocumentFragment` - or, where the host resolves them (dom), a selector matching exactly one element, resolved at mount and when the string changes.
 */
const Portal = PORTAL as unknown as (props: { into: Element | DocumentFragment | string; children?: Node }) => Node;

export {
  PORTAL,
  authoring,
  authorOf,
  createElement,
  Fragment,
  Portal,
  isVNode,
  vnode
};

export type { ComponentInstance, ComponentType, FunctionComponent, Key, Node, VNode };
