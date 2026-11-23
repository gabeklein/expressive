import { Component, Context, unbind } from '@expressive/mvc';
import { watch } from '@expressive/mvc/observable';

import { announce, authored, call, claim, componentProps, consume, dispose, enter, flatten, isBare, isThenable, kindOf, observe, own, placed, renderedAppearance, reserved, resolve, source, syncRoots, unmatched } from '@expressive/jsx';
import type { Appearance, Collection, Declaration, RenderNode as Node, Rendered, Scope, Styles, VNode } from '@expressive/jsx';

import { ALIASES, BOOLEAN, RAW, VOID, isHoisted, isStringified } from './tags';

const SKIPPED = new Set(['children', 'className', 'dangerouslySetInnerHTML', 'defaultChecked', 'defaultValue', 'innerHTML', 'innerText', 'key', 'ref', 'style', 'textContent']);
const CONTENT = ['textContent', 'innerText'];
const CLOSING: Record<string, RegExp> = { script: /<\/(script)/gi, style: /<\/(style)/gi };
const ATTRIBUTE = /^[^\s"'<>/=\u0000-\u001f\u007f]+$/;
const TAG = /^[a-zA-Z][^\s"'<>/=\u0000-\u001f\u007f]*$/;

interface Output {
  /** Markup for the container the node mounts in, as `render()` would leave it. */
  html: string;
  /** Rules the render emitted, for a `<style>` in the document head. */
  css: string;
  /**
   * Hoisted `<title>`, `<meta>` and `<link>` elements, for the document head.
   *
   * The latest title comes first. `html` keeps a marker in their place.
   */
  head: string;
}

interface Options {
  /** Rejects with its reason once aborted, bypassing `catch` boundaries. */
  signal?: AbortSignal;
  /** Emit the range comments `hydrate()` needs. Default `true`; `false` gives static markup. */
  markers?: boolean;
  /** Write each element's plain class rules into its `style` attribute, as email clients need. */
  inline?: boolean;
}

interface Pass {
  contexts: Context[];
  frames: { count: number }[];
  head: string[];
  markers: boolean;
  signal?: AbortSignal;
  sink: Styles;
  inHead?: boolean;
  selected?: string;
}

function kebab(key: string) {
  if (key.startsWith('--')) return key;
  if (key == 'cssFloat') return 'float';
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).replace(/^(webkit|ms)-/, '-$1-');
}

function camel(key: string) {
  return key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()).replace(/^[A-Z]/, (char) => char.toLowerCase());
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

    const css = typeof value == 'number' && value !== 0 && !key.startsWith('--') && !isBare(camel(key)) ? `${value}px` : String(value);

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
 * A `catch` boundary handles an error, then renders again; a retry that fails no further than the last rejects.
 * A portal leaves only its marker; `<title>`, `<meta>` and `<link>` go to `head`, as `render()` hoists them.
 */
async function renderToString(node: Node, options: Options = {}): Promise<Output> {
  announce();

  const { inline, markers = true, signal } = options;
  const rules: string[] = [];
  const roots = new Map<object, string>();
  const sink: Styles = {
    open() {},
    live: () => true,
    hashed: true,
    inline,
    insert: (rule, index) => rules.splice(index, 0, rule),
    root: (key, css) => roots.set(key, css),
    serialize: text
  };
  const context = new Context(Context.root);
  const pass: Pass = { contexts: [context], frames: [], head: [], markers, signal, sink };

  try {
    signal?.throwIfAborted();

    const html = await range(pass, 'fragment', walk(node, pass, context));

    if (rules.length || roots.size) syncRoots(sink);

    const css = [...rules, ...roots.values()].filter(Boolean).join('\n');

    return { html, css, head: pass.head.join('') };
  } catch (thrown) {
    throw thrown instanceof Failure ? thrown.error : thrown;
  } finally {
    for (const context of pass.contexts.reverse()) context.pop();
  }
}

async function range(pass: Pass, kind: string, inner: Promise<string>) {
  return pass.markers ? `<!--${kind}-->${await inner}<!--/${kind}-->` : inner;
}

function marker(pass: Pass) {
  return pass.markers ? '<!--portal-->' : '';
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
      return range(pass, 'component', component(value as Component, pass, context, placed(appearance), svg));
    case 'collection':
      return range(pass, 'collection', collection(value as Collection, pass, context, appearance, svg));
    case 'fragment':
      return range(pass, 'fragment', walk((value as VNode).props.children, pass, context, appearance, svg));
    case 'portal':
      return marker(pass);
    case 'element': {
      const node = value as VNode;

      if (!isHoisted(node.type, node.props) || svg || pass.inHead) return element(node, pass, context, appearance, svg);

      const markup = await element(node, pass, context, appearance, svg);

      if (node.type == 'title') pass.head.unshift(markup);
      else pass.head.push(markup);

      return marker(pass);
    }
    case 'owned':
      return range(pass, 'component', owned(value as VNode, pass, context, appearance, svg));
    default:
      return range(pass, 'function', fn(value as VNode, pass, context, appearance, svg));
  }
}

class Failure {
  constructor(readonly error: unknown, readonly index: number) {}
}

async function attempt<T>(pass: Pass, run: () => T): Promise<T> {
  const frame = pass.frames[pass.frames.length - 1];
  const index = frame ? frame.count++ : 0;
  let spins = 0;

  while (true)
    try {
      return run();
    } catch (thrown) {
      if (!isThenable(thrown)) throw new Failure(thrown, index);
      await settle(thrown, pass.signal);
      if (pass.signal && ++spins % 64 == 0) await settle(new Promise((resolve) => setTimeout(resolve)), pass.signal);
    }
}

function settle<T>(work: T | PromiseLike<T>, signal?: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal!.reason);

    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', abort));

    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
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
  const resolved = componentProps(value.type, value.props, appearance);
  const type = value.type as Function;
  const fiber = {
    kind: 'function',
    type: value.type,
    props: observe(resolved.props),
    appearance: resolved.appearance,
    dev: value.source
  } as Rendered;

  const output = await attempt(pass, () => scoped(context, fiber, () => resolve(type, fiber.props!, () => call(type, fiber.props))));

  return walk(output, pass, context, renderedAppearance(fiber), svg);
}

async function owned(value: VNode, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean) {
  const resolved = componentProps(value.type, value.props, appearance);
  const Type = value.type as new (props: unknown) => Component;
  const props = observe(resolved.props);
  const instance = own(Type, props, new Promise(() => {}));

  return component(instance, pass, context, resolved.appearance, svg, props, value.source);
}

async function component(instance: Component, pass: Pass, context: Context, appearance?: Appearance, svg?: boolean, props?: Record<string, any>, dev?: object): Promise<string> {
  const child = context.push(instance, props ? () => instance.set(null) : undefined);
  const placement = (props || {}) as Pick<Component, 'catch'>;
  const handler = placement.catch || instance.catch;
  const fiber = {
    kind: 'component',
    type: instance.constructor,
    props: props || instance.props,
    instance,
    appearance,
    dev
  } as Rendered;
  let reached = -1;

  pass.contexts.push(child);

  if (handler && pass.frames.length) pass.frames[pass.frames.length - 1].count++;

  while (true) {
    let proxy = instance;
    const release = watch(instance, (current) => { proxy = current; });
    const head = pass.head.slice();

    const frame = { count: 0 };

    if (handler) pass.frames.push(frame);

    try {
      const output = await attempt(pass, () => scoped(child, fiber, () => unbind(proxy.render).call(proxy, fiber.props)));
      return await walk(output, pass, child, renderedAppearance(fiber), svg);
    } catch (thrown) {
      if (!handler) throw thrown;

      const { error, index } = thrown instanceof Failure ? thrown : new Failure(thrown, frame.count);

      if (pass.signal?.aborted || index <= reached) throw error;

      reached = index;
      pass.head.splice(0, Infinity, ...head);
      await settle(handler.call(instance, error instanceof Error ? error : new Error(String(error)), instance), pass.signal);
    } finally {
      if (handler) pass.frames.pop();
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

  const resolved = appearance?.context?.resolve(props, tag);

  unmatched(value.source, props, [appearance?.context], appearance?.author, undefined, tag);

  const claimed = claim(sink, appearance, resolved, props.className, props.style);

  for (const key of Object.keys(props)) {
    const next = props[key];

    if (key[0] == '_') {
      reserved(key);
      continue;
    }

    if (SKIPPED.has(key) || /^on/i.test(key) || typeof next == 'function') continue;
    if (key == 'value' || key == 'checked' || key == 'selected') continue;
    if (!ATTRIBUTE.test(key)) throw new TypeError(`Invalid attribute name "${key}".`);

    attributes += attribute(ALIASES[key] || (inSvg ? key : key.toLowerCase()), key, next);
  }

  if (claimed.className) attributes += ` class="${escape(claimed.className, true)}"`;

  const style = sink.serialize(sink.inline ? flatten(claimed) : claimed.declarations);

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
  else if (content) inner = RAW.has(tag) ? raw(tag, String(props[content])) : escape(String(props[content]));
  else if (tag == 'textarea' && entry != null) inner = escape(String(entry));
  else if (RAW.has(tag)) inner = raw(tag, childrenText(props.children));
  else {
    const { inHead, selected } = pass;

    if (tag == 'select' && entry != null) pass.selected = String(entry);
    if (tag == 'head') pass.inHead = true;

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
      Object.assign(pass, { inHead, selected });
    }
  }

  if (tag == 'title' && !inSvg) inner = inner.replace(/<!--[^>]*-->/g, '');
  if ((tag == 'textarea' || tag == 'pre' || tag == 'listing') && inner[0] == '\n') inner = '\n' + inner;

  return `${open}${inner}</${tag}>`;
}

function attribute(name: string, key: string, value: unknown) {
  if (value === null || value === undefined) return '';
  if (isStringified(key) || key == 'value') return ` ${name}="${escape(String(value), true)}"`;
  if (name == 'hidden' && value === 'until-found') return ` ${name}="${value}"`;
  if (BOOLEAN.has(name) || typeof value == 'boolean') return value ? ` ${name}=""` : '';

  return ` ${name}="${escape(String(value), true)}"`;
}

function raw(tag: string, text: string) {
  const output = text.replace(CLOSING[tag], '<\\/$1');

  return tag == 'script' ? output.replace(/<!--/g, '\\u003C!--') : output;
}

function childrenText(value: unknown): string {
  if (Array.isArray(value)) return value.map(childrenText).join('');
  if (value === null || value === undefined || typeof value == 'boolean') return '';
  return String(value);
}

export { renderToString };
export type { Options, Output };
