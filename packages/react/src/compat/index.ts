import { elementType, Runtime } from '@expressive/react/adapter';
import { Component } from '@expressive/mvc';
import { elements, type Renderable } from '@expressive/mvc/jsx-runtime';
import { options, type ComponentChildren } from 'preact';
import * as compat from 'preact/compat';

import './jsx-runtime';
import { ErrorBoundary } from './boundary';

const ELEMENT = Symbol('element');

elements((Type) => {
  Object.defineProperty(Type.prototype, ELEMENT, { value: true });
});

const vnode = options.vnode;

options.vnode = (node) => {
  const { children } = node.props;
  const adopted = adopt(children);

  if (adopted !== children) node.props.children = adopted;

  vnode?.(node);
};

function adopt(child: ComponentChildren): ComponentChildren {
  if (Array.isArray(child)) {
    const next = child.map(adopt);

    return next.some((item, i) => item !== child[i]) ? next : child;
  }

  if (child && typeof child == 'object' && ELEMENT in child) {
    const self = (child as unknown as Renderable).is;

    return compat.createElement(adopted(self), {
      key: self instanceof Component ? self.key : undefined
    });
  }

  return child;
}

const TYPES = new WeakMap<Renderable, () => ComponentChildren>();

function adopted(self: Renderable) {
  let type = TYPES.get(self);

  if (!type) {
    const render = elementType(self) as () => ComponentChildren;

    TYPES.set(self, type = () => adopt(render()));
  }

  return type;
}

Object.assign(Runtime, {
  idle: () => undefined,
  createElement: compat.createElement,
  createContext: compat.createContext,
  useContext: compat.useContext,
  useEffect: compat.useEffect,
  useState: compat.useState,
  useRef: compat.useRef,
  Suspense: compat.Suspense,
  ErrorBoundary,
  ignore: [
    '__v',
    '__n',
    '__d',
    '__e',
    '__h',
    '_sb',
    '__s',
    '__P',
    '__z',
    '__R',
    'base',
    'componentWillUnmount'
  ]
});

// Type-only, so this entry's .d.ts stays linked to the adapter's augmentations.
export type { Runtime } from '@expressive/react/adapter';
