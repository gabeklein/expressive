import { Children, isValidElement } from 'react';
import { Fragment, jsx as base, jsxs as bases } from 'react/jsx-runtime';
import { host } from '@expressive/jsx/jsx-runtime';
import { root, stamp } from './style';

import type { Component as ReactComponent, CSSProperties as ReactCSSProperties, JSX as ReactJSX, ReactNode } from 'react';

declare module '@expressive/mvc/host' {
  interface Host {
    node: ReactNode;
    intrinsics: ReactJSX.IntrinsicElements;
    elementClass: ReactComponent<any, any>;
  }
}

host({
  jsx: base,
  jsxs: bases,
  Fragment,
  isElement: isValidElement,
  childrenOf: Children.toArray,
  typeOf(node){
    return isValidElement(node) ? node.type : undefined;
  },
  propsOf(node){
    return isValidElement(node) ? node.props as Record<string, unknown> : {};
  }
});

const jsx: typeof base = (type, props, key) => base(root(type), stamp(props), key);
const jsxs: typeof bases = (type, props, key) => bases(root(type), stamp(props), key);

type Styled = { [attribute: `_${string}`]: unknown };
type StyleProp = string | ReactCSSProperties | false | null | undefined | readonly StyleProp[];
type Widen<P> = Omit<P, 'style'> & Styled & { style?: StyleProp };

export { Fragment, jsx, jsxs };
export declare namespace JSX {
  type ElementType = ReactJSX.ElementType;
  interface Element extends ReactJSX.Element {}
  interface ElementClass extends ReactJSX.ElementClass {}
  interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
  interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
  type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
  interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes, Styled {}
  interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> {}
  type IntrinsicElements = {
    [K in keyof ReactJSX.IntrinsicElements]: Widen<ReactJSX.IntrinsicElements[K]>;
  };
}
