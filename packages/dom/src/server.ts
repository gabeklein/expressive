import './jsx-runtime';

import { Component, Context, unbind } from '@expressive/mvc';
import { watch } from '@expressive/mvc/observable';

import { call, dispose, enter } from './core/adapter';
import type { Scope } from './core/adapter';
import { authored, consume, observe, renderedAppearance } from './core/appearance';
import type { Rendered } from './core/appearance';
import { unplaced } from './core/placement';
import { isThenable, kindOf, source } from './node/kind';
import type { Collection } from './node/kind';
import { resolve } from './node/loader';
import { ALIASES, isStringified } from './node/props';
import type { Node, VNode } from './node/vnode';
import { claim, componentProps, placed } from './style/claim';
import type { Appearance } from './style/claim';
import { serialize } from './style/declarations';
import type { Declaration } from './style/declarations';
import { unmatched } from './style/diagnose';
import { reserved, serving } from './style/protocol';
import type { Sink } from './style/protocol';
import { attachRoots } from './style/root';

const UNITLESS = new Set(
  ('animationIterationCount aspectRatio baselineShift borderImageOutset borderImageSlice borderImageWidth columnCount ' +
  'columns cx cy fillOpacity flex flexGrow flexShrink floodOpacity fontSizeAdjust fontWeight gridArea gridColumn ' +
  'gridColumnEnd gridColumnStart gridRow gridRowEnd gridRowStart hyphenateLimitChars initialLetter lineHeight mathDepth ' +
  'opacity order orphans r rx ry scale shapeImageThreshold stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit ' +
  'strokeOpacity strokeWidth tabSize webkitBoxFlex webkitBoxOrdinalGroup webkitLineClamp widows x y zIndex zoom').split(' ')
);

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style']);
const NAMES: Record<string, string> = { ...ALIASES, acceptCharset: 'accept-charset', httpEquiv: 'http-equiv' };
const BOOLEAN = new Set(
  ('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap ' +
  'itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected').split(' ')
);
const SKIPPED = new Set(['children', 'className', 'dangerouslySetInnerHTML', 'defaultChecked', 'defaultValue', 'innerHTML', 'innerText', 'key', 'ref', 'style', 'textContent']);
const CONTENT = ['textContent', 'innerText'];
const ATTRIBUTE = /^[^\s"'<>/=\u0000-\u001f\u007f]+$/;
const TAG = /^[a-zA-Z][^\s"'<>/=\u0000-\u001f\u007f]*$/;
const CLOSING = { script: /<(\/script|!--)/gi, style: /<(\/style)/gi } as Record<string, RegExp>;

interface Output {
  /** Markup for the container the node mounts in, as `render()` would leave it. */
  html: string;
  /** Rules the render emitted, for a `<style>` in the document head. */
  css: string;
}

interface Pass {
  contexts: Context[];
  sink: Sink;
  selected?: string;
}

function kebab(key: string) {
  if (key.startsWith('--')) return key;
  if (key == 'cssFloat') return 'float';
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).replace(/^(webkit|ms)-/, '-$1-');
}

function camel(key: string) {
  return key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function contained(value: string) {
  let depth = 0;
  let quote = '';

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    if (char == '\\') index++;
    else if (quote) quote = char == quote ? '' : quote;
    else if (char == '"' || char == "'") quote = char;
    else if (char == '(') depth++;
    else if (char == ')') depth--;
    else if (!depth && (char == ';' || char == '{' || char == '}')) return false;

    if (depth < 0) return false;
  }

  return !depth && !quote;
}

function text(declarations: Declaration) {
  const output: string[] = [];

  for (const key of Object.keys(declarations)) {
    const value = declarations[key];

    if (value == null || value === '' || typeof value == 'boolean') continue;
    if (typeof value == 'number' && !Number.isFinite(value)) continue;

    const css = typeof value == 'number' && value !== 0 && !key.startsWith('--') && !UNITLESS.has(camel(key)) ? `${value}px` : String(value);

    if (contained(css)) output.push(`${kebab(key)}: ${css.replace(/</g, '\\3c ')};`);
  }

  return output.join(' ');
}

function escape(value: string, attribute?: boolean) {
  const output = value
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return attribute ? output.replace(/"/g, '&quot;') : output;
}

/**
 * Render a node to markup and the style rules it emits, waiting on anything it suspends for.
 *
 * `new()` runs and is not awaited; effects and `ready` never do. Owned instances are destroyed once rendered.
 * A suspended render is awaited and retried in place; no fallback is drawn. Calls may run concurrently.
 * A `catch` boundary handles an error once, then renders again; a second error propagates.
 * A portal leaves only its marker.
 */
async function renderToString(node: Node): Promise<Output> {
  const rules: string[] = [];
  const roots = new Map<object, string>();
  const sink: Sink = {
    insert: (rule, index) => rules.splice(index, 0, rule),
    root: (key, css) => roots.set(key, css),
    serialize: text,
    unitless: (property) => UNITLESS.has(property)
  };
  const context = new Context(Context.root);
  const pass: Pass = { contexts: [context], sink };

  try {
    const html = await range('fragment', walk(node, pass, context));

    if (roots.size) attachRoots(sink);

    const css = [...rules, ...roots.values()].filter(Boolean).join('\n');

    return { html, css };
  } finally {
    for (const context of pass.contexts.reverse()) context.pop();
  }
}

async function range(kind: string, inner: Promise<string>) {
  return `<!--${kind}-->${await inner}<!--/${kind}-->`;
}

async function walk(value: Node, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean): Promise<string> {
  if (Array.isArray(value)) {
    let output = '';

    for (const each of value) output += await walk(each, pass, context, appearance, svg);

    return output;
  }

  if (value === null || value === undefined || typeof value == 'boolean') return '';

  const by = appearance?.author as Rendered | undefined;

  value = source(value);
  appearance = authored(value, appearance);

  switch (kindOf(value, by)) {
    case 'text':
      return escape(String(value));
    case 'component':
      return range('component', component(value as Component, pass, context, placed(appearance), svg));
    case 'collection':
      return range('collection', collection(value as Collection, pass, context, appearance, svg));
    case 'fragment':
      return range('fragment', walk((value as VNode).props.children, pass, context, appearance, svg));
    case 'portal':
      return '<!--portal-->';
    case 'element':
      return element(value as VNode, pass, context, appearance, svg);
    case 'owned':
      return range('component', owned(value as VNode, pass, context, appearance, svg));
    default:
      return range('function', fn(value as VNode, pass, context, appearance, svg));
  }
}

async function attempt<T>(pass: Pass, run: () => T): Promise<T> {
  while (true)
    try {
      return serving(pass.sink, run);
    } catch (thrown) {
      if (!isThenable(thrown)) throw thrown;
      await thrown;
    }
}

function scoped(context: Context, fiber: Rendered, render: () => Node) {
  const scope = { active: true, context, subscriptions: [] } as unknown as Scope;

  try {
    return consume(fiber, () => enter(scope, render));
  } finally {
    dispose(scope);
  }
}

async function fn(value: VNode, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean) {
  const resolved = serving(pass.sink, () => componentProps(value.type, value.props, appearance));
  const type = value.type as Function;
  const fiber = {
    kind: 'function',
    type: value.type,
    props: observe(resolved.props),
    appearance: resolved.appearance
  } as Rendered;

  const output = await attempt(pass, () => scoped(context, fiber, () => resolve(type, fiber.props!, () => call(type, fiber.props))));

  return walk(output, pass, context, serving(pass.sink, () => renderedAppearance(fiber)), svg);
}

async function owned(value: VNode, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean) {
  const resolved = serving(pass.sink, () => componentProps(value.type, value.props, appearance));
  const Type = value.type as new (props: unknown) => Component;
  const props = observe(resolved.props);
  const instance = new Type(props);

  unplaced(instance);

  return component(instance, pass, context, resolved.appearance, svg, props);
}

async function component(instance: Component, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean, props?: Record<string, any>): Promise<string> {
  const child = context.push(instance, props ? () => instance.set(null) : undefined);
  const placement = (props || {}) as Pick<Component, 'catch'>;
  const handler = placement.catch || instance.catch;
  const fiber = {
    kind: 'component',
    type: instance.constructor,
    props: props || instance.props,
    instance,
    appearance
  } as Rendered;
  let caught = false;

  pass.contexts.push(child);

  while (true) {
    let proxy = instance;
    const release = watch(instance, (current) => { proxy = current; });

    try {
      const output = await attempt(pass, () => scoped(child, fiber, () => unbind(proxy.render).call(proxy, fiber.props)));
      return await walk(output, pass, child, serving(pass.sink, () => renderedAppearance(fiber)), svg);
    } catch (thrown) {
      if (!handler || caught) throw thrown;

      caught = true;
      await handler.call(instance, thrown instanceof Error ? thrown : new Error(String(thrown)), instance);
    } finally {
      release();
    }
  }
}

async function collection(value: Parameters<typeof watch>[0], pass: Pass, context: Context, appearance?: Appearance, svg?: boolean) {
  let proxy = value;
  const release = watch(value, (current) => { proxy = current; });

  try {
    const output = await attempt(pass, () => (proxy as unknown as { render(): Node }).render());
    return walk(output, pass, context, appearance, svg);
  } finally {
    release();
  }
}

async function element(value: VNode, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean) {
  const tag = value.type as string;
  const props = value.props as Record<string, any>;
  const inSvg = tag == 'svg' || !!svg;
  const { sink } = pass;
  let attributes = '';

  if (!TAG.test(tag)) throw new TypeError(`Invalid element name "${tag}".`);

  const claimed = serving(sink, () => {
    const resolved = appearance?.context?.resolve(props, tag);

    unmatched(props, [appearance?.context], appearance?.author, undefined, tag);

    return claim(sink, appearance, resolved, props.className, props.style);
  });

  for (const key of Object.keys(props)) {
    const next = props[key];

    if (key[0] == '_') {
      reserved(key);
      continue;
    }

    if (SKIPPED.has(key) || /^on/i.test(key) || typeof next == 'function') continue;
    if (key == 'value' || key == 'checked' || key == 'selected') continue;
    if (!ATTRIBUTE.test(key)) throw new TypeError(`Invalid attribute name "${key}".`);

    attributes += attribute(NAMES[key] || (inSvg ? key : key.toLowerCase()), key, next);
  }

  if (claimed.className) attributes += ` class="${escape(claimed.className, true)}"`;

  const style = serialize(sink, claimed.declarations);

  if (style) attributes += ` style="${escape(style, true)}"`;

  const entry = props.value ?? props.defaultValue;
  const checked = props.checked ?? props.defaultChecked;

  if (tag != 'textarea' && tag != 'select') attributes += attribute('value', 'value', entry);
  attributes += attribute('checked', 'checked', checked);
  attributes += attribute('selected', 'selected', props.selected ?? (tag == 'option' && pass.selected === String(props.value ?? childrenText(props.children)) || undefined));

  const open = `<${tag}${attributes}>`;

  if (VOID.has(tag) && !inSvg) return open;

  const content = CONTENT.find((key) => props[key] != null);
  let inner: string;

  if ('dangerouslySetInnerHTML' in props) inner = props.dangerouslySetInnerHTML?.__html || '';
  else if (props.innerHTML != null) inner = String(props.innerHTML);
  else if (content) inner = escape(String(props[content]));
  else if (tag == 'textarea' && entry != null) inner = escape(String(entry));
  else if (RAW.has(tag)) inner = childrenText(props.children).replace(CLOSING[tag], '<\\$1');
  else {
    const outer = pass.selected;

    if (tag == 'select' && entry != null) pass.selected = String(entry);

    try {
      inner = await walk(
        props.children,
        pass,
        context,
        claimed.context || appearance?.author
          ? { author: appearance?.author, context: claimed.context, entries: [] }
          : undefined,
        inSvg && tag != 'foreignObject'
      );
    } finally {
      pass.selected = outer;
    }
  }

  if ((tag == 'textarea' || tag == 'pre' || tag == 'listing') && inner[0] == '\n') inner = '\n' + inner;

  return `${open}${inner}</${tag}>`;
}

function attribute(name: string, key: string, value: unknown) {
  if (value === null || value === undefined) return '';
  if (isStringified(key)) return ` ${name}="${escape(String(value), true)}"`;
  if (name == 'hidden' && value === 'until-found') return ` ${name}="${value}"`;
  if (BOOLEAN.has(name) || typeof value == 'boolean') return value ? ` ${name}=""` : '';

  return ` ${name}="${escape(String(value), true)}"`;
}

function childrenText(value: unknown): string {
  if (Array.isArray(value)) return value.map(childrenText).join('');
  if (value === null || value === undefined || typeof value == 'boolean') return '';
  return String(value);
}

export { renderToString };
export type { Output };
