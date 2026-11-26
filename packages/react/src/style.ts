import type { Component, Model } from '@expressive/mvc';
import * as React from 'react';
import { Fragment, forwardRef, isValidElement, lazy, memo } from 'react';
import { jsx as base, jsxs } from 'react/jsx-runtime';

import { authorAppearance, placeComponent, renderComponent, styleElement } from './jsx-internals';
import type { Appearance, Declaration, Rendered as Tracked, Styles } from './jsx-internals';

export { style, Style, Css } from './jsx-internals';

/**
 * SPIKE: React host for @expressive/jsx's style engine.
 *
 * jsx's reconciler threads an `Appearance` through mount and patch. React
 * reconciles on its own, so this host:
 * - records each element's author at creation (wrapped jsx runtime),
 * - walks a component's returned tree before React sees it, styling host
 *   elements through `styleElement` and handing component elements their
 *   appearance through a WeakMap keyed by the element's props object.
 */

interface Rendered extends Tracked {
  kind: 'component' | 'function';
  type: object;
  props: Record<string, any>;
}

const AUTHOR = Symbol('author');
const RECORDS = new WeakMap<object, Rendered>();
const EXOTIC = new WeakMap<object, object>();
const HOSTED = new WeakSet<object>();
const MEMO = Symbol.for('react.memo');
const FORWARD = Symbol.for('react.forward_ref');
const LAZY = Symbol.for('react.lazy');
const PORTAL = Symbol.for('react.portal');
const INCOMING = new WeakMap<object, Appearance | undefined>();
const SUBS = new WeakMap<Function, { owner: Model; key: string }>();
const WRAPPED = new WeakMap<object, Function>();
const WRAPPERS = new WeakSet<Function>();

let author: Rendered | undefined;

function jsx(type: any, props: Record<string, any>, key: unknown) {
  return (Array.isArray(props.children) ? jsxs : base)(type, props, key == null ? undefined : String(key));
}

/**
 * Stamp the current author into props before React builds the element. A
 * symbol key survives `cloneElement` and `Children.toArray`, which copy props;
 * an inherited stamp from a spread is overwritten.
 */
function stamp<P>(props: P): P {
  if (props && typeof props == 'object') {
    if (author) (props as any)[AUTHOR] = author;
    else if (AUTHOR in props) delete (props as any)[AUTHOR];
  }
  return props;
}

function authorOf(value: any): Rendered | undefined {
  return value?.props?.[AUTHOR];
}

/** Function, memo, forwardRef and lazy types are hosted at creation, so a reused element keeps its identity across walks. */
function root(type: unknown): any {
  if (typeof type == 'function') return wrap(type);
  if (type && typeof type == 'object') return exotic(type as any);
  return type;
}

function exotic(type: any) {
  if (HOSTED.has(type)) return type;

  let hosted = EXOTIC.get(type);
  if (hosted) return hosted;

  switch (type.$$typeof) {
    case MEMO:
      hosted = memo(typeof type.type == 'function' ? wrap(type.type, type) : root(type.type), type.compare);
      break;
    case FORWARD:
      hosted = forwardRef(hostRender(type, type.render));
      break;
    case LAZY:
      hosted = lazy(() => new Promise<{ default: any }>((resolve, reject) => {
        const attempt = () => {
          try {
            resolve({ default: root(type._init(type._payload)) });
          } catch (thrown: any) {
            if (thrown && typeof thrown.then == 'function') thrown.then(attempt, reject);
            else reject(thrown);
          }
        };
        attempt();
      }));
      break;
    default:
      return type;
  }

  HOSTED.add(hosted!);
  EXOTIC.set(type, hosted!);
  return hosted;
}

const UNITLESS = new Set(
  ('animationIterationCount aspectRatio columnCount columns fillOpacity flex flexGrow flexShrink fontWeight gridArea ' +
  'gridColumn gridRow lineHeight opacity order orphans scale strokeOpacity strokeWidth tabSize widows zIndex zoom').split(' ')
);

function kebab(key: string) {
  return key.startsWith('--') ? key : key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function serialize(declarations: Declaration) {
  return Object.keys(declarations)
    .filter((key) => declarations[key] != null && declarations[key] !== '')
    .map((key) => {
      const value = declarations[key];
      const css = typeof value == 'number' && value !== 0 && !key.startsWith('--') && !UNITLESS.has(key) ? `${value}px` : String(value);
      return `${kebab(key)}: ${css};`;
    })
    .join(' ');
}

/** Rules by class name, process-wide: the engine emits each block once per `Styles`, so later requests look rules up instead. */
const RULES = new Map<string, string>();
const ORDER: string[] = [];
const DEPTHS = 4;
const ROOTS = new Map<object, string>();

const server: Styles = {
  open() {},
  live: () => true,
  insert(rule, index) {
    const selector = rule.slice(0, rule.lastIndexOf('{', rule.indexOf('}')));
    const name = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].pop()?.[1];
    if (!name) return;
    RULES.set(name, (RULES.get(name) ? RULES.get(name) + '\n' : '') + rule);
    ORDER.splice(index, 0, name);
  },
  root: (key, css) => void ROOTS.set(key, css),
  serialize
};

let client: Styles | undefined;

function document(): Styles {
  if (client) return client;

  let element: HTMLStyleElement | undefined;
  const roots = new Map<object, HTMLStyleElement>();

  return client = {
    open() {
      element = window.document.createElement('style');
      element.dataset.expressive = 'react';
      window.document.head.append(element);
    },
    live: () => !!element?.sheet,
    insert: (rule, index) => void element!.sheet!.insertRule(rule, index),
    root(key, css) {
      let node = roots.get(key);

      if (!node?.isConnected) {
        node = window.document.createElement('style');
        node.dataset.expressive = 'root';
        window.document.head.append(node);
        roots.set(key, node);
      }

      if (node.textContent !== css) node.textContent = css;
    },
    serialize
  };
}

const onServer = () => typeof window == 'undefined';
let used: Set<string> | undefined;

function styles(): Styles {
  return onServer() ? server : document();
}

function depthOf(name: string) {
  const match = /-d(\d+)(?=-|$)/.exec(name);
  return Math.min(match ? Number(match[1]) : 0, DEPTHS - 1);
}

/**
 * React orders precedence groups by first sight, so every host leads with a
 * placeholder per depth (deduped by href) and a class lands in its depth's
 * group - a caller rule always follows a callee base, whatever renders first.
 * Within a host, classes follow the engine's sheet order.
 */
function tags() {
  const output: unknown[] = [];

  for (let depth = 0; depth < DEPTHS; depth++)
    output.push(base('style', { href: `ex-order-${depth}`, precedence: `expressive-${depth}`, children: '/**/' }, `order-${depth}`));

  for (const css of ROOTS.values())
    if (css) output.push(base('style', { href: `ex-root-${hash(css)}`, precedence: 'expressive-0', children: css }, `root-${hash(css)}`));

  const names = [...used!].filter((name) => RULES.has(name)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  for (const name of names)
    output.push(base('style', { href: `ex-${name}`, precedence: `expressive-${depthOf(name)}`, children: RULES.get(name) }, name));

  return names.length ? output : [];
}

function hash(text: string) {
  let value = 5381;
  for (let index = 0; index < text.length; index++) value = (value * 33) ^ text.charCodeAt(index);
  return (value >>> 0).toString(36);
}

function subcomponent(fn: Function, owner: Model, key: string) {
  SUBS.set(fn, { owner, key });
}

/** Run a component render under author tracking, then resolve its output. */
function host(fiber: Rendered, render: () => unknown) {
  const previous = author;

  author = fiber;

  let rendered: { output: unknown; appearance: Appearance | undefined };

  try {
    rendered = renderComponent(fiber, render);
  } finally {
    author = previous;
  }

  if (!onServer()) return walk(rendered.output, rendered.appearance);

  const outer = used;
  used = new Set();

  try {
    const resolved = walk(rendered.output, rendered.appearance);
    const emitted = tags();

    return emitted.length ? jsxs(Fragment, { children: [...emitted, resolved] }) : resolved;
  } finally {
    used = outer;
  }
}

function walk(value: unknown, appearance: Appearance | undefined): unknown {
  if (!Array.isArray(value)) return place(value, appearance);

  const next = value.map((each) => walk(each, appearance));

  return next.every((each, index) => each === value[index]) ? value : next;
}

const CONTEXT = Symbol.for('react.context');
const PROVIDER = Symbol.for('react.provider');

/** Clones lose React's dev-only key validation mark; carry it over. */
function clone(from: any, type: any, props: Record<string, any>) {
  const output: any = jsx(type, props, from.key);

  if (from._store && output._store) output._store.validated = from._store.validated;
  return output;
}

function place(value: unknown, inherited: Appearance | undefined): unknown {
  if ((value as any)?.$$typeof === PORTAL) {
    const portal = value as any;
    const children = walk(portal.children, inherited);

    return children === portal.children ? portal : { ...portal, children };
  }

  if (!isValidElement(value) || Object.getPrototypeOf(value) !== Object.prototype) return value;

  const appearance = authorAppearance(authorOf(value), inherited);
  const { type } = value as any;
  const props = value.props as Record<string, any>;

  if (typeof type == 'string') return element(value, type, props, appearance);

  if (type === Fragment || typeof type == 'symbol' || type?.$$typeof === CONTEXT || type?.$$typeof === PROVIDER) {
    const children = walk(props.children, appearance);
    const fallback = walk(props.fallback, appearance);

    return children === props.children && fallback === props.fallback
      ? value
      : clone(value, type, { ...props, children, fallback });
  }

  if (typeof type != 'function' && !HOSTED.has(type)) return value;

  const resolved = placeComponent(typeof type == 'function' ? type : () => {}, props, appearance);

  if (resolved.props === props) {
    INCOMING.set(props, resolved.appearance);
    return value;
  }

  const output = clone(value, type, { ...resolved.props });

  INCOMING.set(output.props as object, resolved.appearance);
  return output;
}

function element(value: unknown, type: string, props: Record<string, any>, appearance: Appearance | undefined) {
  const { claim, inner } = styleElement(styles(), type, props, appearance);
  const next: Record<string, any> = {};
  let changed = claim.className !== (props.className || '');

  for (const name in props) {
    if (name[0] == '_') {
      changed = true;
      continue;
    }
    if (name != 'className' && name != 'style' && name != 'children') next[name] = props[name];
  }

  const style = props.style;
  const declarations = claim.declarations;
  const keys = Object.keys(declarations);

  if (style === undefined ? keys.length : typeof style != 'object' || Array.isArray(style) || keys.length != Object.keys(style).length || keys.some((key) => style[key] !== declarations[key]))
    changed = true;

  if (claim.className) next.className = claim.className;
  if (used) for (const name of claim.className.split(' ')) if (name) used.add(name);
  if (keys.length) next.style = declarations;

  if ('children' in props) {
    next.children = walk(props.children, inner);
    if (next.children !== props.children) changed = true;
  }

  return changed ? clone(value, type, next) : value;
}

/** One record per mounted component, so elements memoized across renders keep their author. */
function useRecord(type: object, props: Record<string, any>) {
  const ref: { current?: Rendered } = React.useRef ? React.useRef<Rendered>(undefined) : {};
  const record = (ref.current ||= { kind: 'function', type, props });

  record.type = type;
  record.props = props;
  record.method = SUBS.get(type as Function);
  record.appearance = INCOMING.get(props);
  return record;
}

/** Plain function components render through a host so their output is resolved too. */
function wrap(type: Function, as: object = type) {
  if (type.prototype?.isReactComponent || WRAPPERS.has(type)) return type;

  let wrapper = WRAPPED.get(as);

  if (!wrapper) {
    wrapper = (props: Record<string, any>) => {
      const record = useRecord(as, props);
      return host(record, () => type(record.props));
    };
    Object.defineProperty(wrapper, 'name', { value: type.name });
    WRAPPED.set(as, wrapper);
    WRAPPERS.add(wrapper);
  }

  return wrapper;
}

function hostRender(as: object, render: Function) {
  const hosted = (props: Record<string, any>, ref: unknown) => {
    const record = useRecord(as, props);
    return host(record, () => render(record.props, ref));
  };

  Object.defineProperty(hosted, 'name', { value: render.name });
  return hosted as any;
}

/** Host a class Component's render. */
function hostComponent(instance: Component, render: Function, own: Function | false, props: Record<string, any>) {
  let record = RECORDS.get(instance.is);

  if (!record) RECORDS.set(instance.is, (record = { kind: 'component', type: instance.constructor, props }));

  record.type = instance.constructor;
  record.props = props;
  record.instance = instance;
  record.appearance = INCOMING.get(props);

  return host(record, () => render.call(instance, props));
}

/**
 * Register a function component's host with react-refresh beside the
 * component itself, so an edit swaps the host in place. A bundler plugin
 * would emit this next to each `$RefreshReg$`.
 */
function refresh(type: Function, id: string, register: (type: unknown, id: string) => void) {
  register(wrap(type), `${id}%styled`);
}

export { hostComponent, root, refresh, stamp, subcomponent, wrap };
