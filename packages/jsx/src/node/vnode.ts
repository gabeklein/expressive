import { Fragment as FRAGMENT, jsx, onElement } from '@expressive/mvc/jsx-runtime';
import type { Element as Created } from '@expressive/mvc/jsx-runtime';
import type { has, map } from '@expressive/mvc';
import type { JSX as Runtime } from '../jsx-runtime';

const PORTAL = Symbol('@expressive/dom.portal');
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

interface VNode<P = any> extends Created<P & { children?: Node }> {
  readonly type: string | symbol | ComponentType<P>;
}

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
type JsxManaged<C, P> = Runtime.LibraryManagedAttributes<C, P>;
type JsxChildrenAttribute = Runtime.ElementChildrenAttribute;
type JsxIntrinsicAttributes = Runtime.IntrinsicAttributes;
type JsxIntrinsicElements = Runtime.IntrinsicElements;

declare namespace createElement {
  namespace JSX {
    type Element = JsxElement;
    type ElementType = JsxElementType;
    interface ElementClass extends JsxElementClass {}
    interface ElementAttributesProperty extends JsxAttributesProperty {}
    type LibraryManagedAttributes<C, P> = JsxManaged<C, P>;
    interface ElementChildrenAttribute extends JsxChildrenAttribute {}
    interface IntrinsicAttributes extends JsxIntrinsicAttributes {}
    type IntrinsicElements = JsxIntrinsicElements;
  }
}

function isVNode(value: unknown): value is VNode {
  return !!value && typeof value == 'object' && (value as { [ELEMENT]?: true })[ELEMENT] === true;
}

/** Groups children without a wrapping element. */
const Fragment = FRAGMENT as unknown as (props: { children?: Node }) => Node;
/**
 * Render children into another element, keeping their context, ownership and boundaries.
 *
 * `into` is an `Element`, a `DocumentFragment`, or a selector matching exactly one element - resolved at mount and when the string changes.
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
