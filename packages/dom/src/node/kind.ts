import { Component, has, map, Model } from '@expressive/mvc';
import { Fragment } from '@expressive/mvc/jsx-runtime';

import { isVNode, PORTAL, VNODE } from './vnode';
import type { Node, VNode } from './vnode';

type Kind = 'text' | 'component' | 'collection' | 'fragment' | 'portal' | 'element' | 'owned' | 'function';

type Collection = has.List<unknown> | has.Pool<unknown> | map.Managed<unknown, unknown>;

interface Author {
  type?: unknown;
}

function kindOf(value: Node, by?: Author): Kind {
  if (typeof value == 'string' || typeof value == 'number' || typeof value == 'bigint') return 'text';
  if (renderable(value)) return 'component';
  if (value instanceof Model) notRenderable(value.constructor, by);
  if (isCollection(value)) return 'collection';
  if (!isVNode(value)) throw unrenderable(value, by);

  const { type } = value as VNode;

  if (type === Fragment) return 'fragment';
  if (type === PORTAL) return 'portal';
  if (typeof type == 'string') return 'element';
  if (typeof type != 'function') throw unrenderable(type, by, true);
  if (type === Component || type.prototype instanceof Component) return 'owned';
  if (type.prototype instanceof Model) notRenderable(type, by);

  return 'function';
}

function source(value: Node): Node {
  if (value instanceof Model) return value.is;

  while (isCollection(value) && isCollection(Object.getPrototypeOf(value)))
    value = Object.getPrototypeOf(value);

  return value;
}

function renderable(value: unknown): value is Component {
  return value instanceof Component;
}

function isCollection(value: unknown): value is Collection {
  return value instanceof has.List || value instanceof has.Pool || value instanceof map.Managed;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as PromiseLike<unknown>).then == 'function';
}

function unrenderable(value: unknown, by?: Author, asType?: boolean) {
  const foreign = typeof value == 'symbol'
    ? value.description == PORTAL.description
    : !!value && typeof value == 'object' && !isVNode(value) && Object.getOwnPropertySymbols(value).some((key) => key.description == VNODE.description);
  const what = foreign ? `${typeof value == 'symbol' ? 'a portal' : 'an element'} from another copy of @expressive/dom` : describe(value);
  const message = asType ? `Cannot use ${what} as an element type` : `Cannot render ${what}`;

  return new TypeError(`${message}${within(by)}.${foreign ? ' Is the package loaded twice?' : ''}`);
}

function describe(value: unknown) {
  if (typeof value == 'function') return value.name ? `function ${value.name}` : 'an anonymous function';
  if (!value || typeof value != 'object') return String(value);
  if (isVNode(value)) return 'an element';

  const type = Object.getPrototypeOf(value)?.constructor;

  return type && type !== Object ? `an instance of ${type.name || 'an anonymous class'}` : 'a plain object';
}

function within(by?: Author) {
  return by?.type ? ` in ${(by.type as Function).name || 'an anonymous component'}` : '';
}

function notRenderable(type: Function, by?: Author): never {
  throw new Error(`${type.name}${within(by)} is a Model - extend Component to render it, or provide it with <Component for={${type.name}}>.`);
}

export { isCollection, isThenable, kindOf, renderable, source };
export type { Collection, Kind };
