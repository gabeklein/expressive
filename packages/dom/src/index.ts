import { createElement as create } from '@expressive/jsx';
import type { VNode } from '@expressive/jsx';
import type { JSX as Dom } from './jsx-runtime';

export { Css, Fragment, Portal, Style, style } from '@expressive/jsx';
export { hydrate, render } from './host';
export type { JSX } from './jsx-runtime';

/** Classic JSX factory - `key` comes off `props`, children land on `props.children`. */
export function createElement(type: VNode['type'], props?: Record<string, unknown> | null, ...children: unknown[]): VNode {
  return create(type, props, ...children);
}

type DomElement = Dom.Element;
type DomElementType = Dom.ElementType;
type DomElementClass = Dom.ElementClass;
type DomAttributesProperty = Dom.ElementAttributesProperty;
type DomManaged<C, P> = Dom.LibraryManagedAttributes<C, P>;
type DomChildrenAttribute = Dom.ElementChildrenAttribute;
type DomIntrinsicAttributes = Dom.IntrinsicAttributes;
type DomIntrinsicElements = Dom.IntrinsicElements;

export declare namespace createElement {
  namespace JSX {
    type Element = DomElement;
    type ElementType = DomElementType;
    interface ElementClass extends DomElementClass {}
    interface ElementAttributesProperty extends DomAttributesProperty {}
    type LibraryManagedAttributes<C, P> = DomManaged<C, P>;
    interface ElementChildrenAttribute extends DomChildrenAttribute {}
    interface IntrinsicAttributes extends DomIntrinsicAttributes {}
    type IntrinsicElements = DomIntrinsicElements;
  }
}
