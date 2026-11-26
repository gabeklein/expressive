import { PORTAL, claim, flatten, fragment, hostOf, isBare, isVNode, reconcileChildren, reserved, settled, syncRoots, unmatched, vnode } from '@expressive/jsx';
import type { Declaration, Host, RenderNode as Node, Root, Styles } from '@expressive/jsx';

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

class Markup {
  parentNode: Markup | null = null;
  childNodes: Markup[] = [];
  props: Record<string, any> = {};
  claimed?: ReturnType<typeof claim>;
  svg?: boolean;

  constructor(readonly nodeType: number, public nodeValue = '', readonly tag = '') {}

  get nextSibling(): Markup | null {
    const siblings = this.parentNode!.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  getRootNode(): Markup {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }

  insertBefore<T extends Markup>(node: T, before: Markup | null): T {
    const nodes = node.nodeType == 11 ? node.childNodes.slice() : [node];

    for (const each of nodes) {
      each.remove();
      const index = before ? this.childNodes.indexOf(before) : -1;
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, each);
      each.parentNode = this;
    }

    return node;
  }

  appendChild<T extends Markup>(node: T) {
    return this.insertBefore(node, null);
  }

  append(...nodes: Markup[]) {
    for (const node of nodes) this.insertBefore(node, null);
  }

  remove() {
    const parent = this.parentNode;

    if (!parent) return;

    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
}

const asNode = (markup: Markup) => markup as unknown as globalThis.Node;
const asMarkup = (node: globalThis.Node) => node as unknown as Markup;

function elementOf(node: Markup | null) {
  while (node && node.nodeType != 1) node = node.parentNode;
  return node;
}

function inSvg(parent: globalThis.Node) {
  const element = elementOf(asMarkup(hostOf(parent)));
  return !!element?.svg && element.tag != 'foreignObject';
}

function stringHost(sink: Styles): Host {
  const discard = new Markup(11);
  const host: Host = {
    target: (container) => container as unknown as Document,
    styles: () => sink,
    text: (_, value) => asNode(new Markup(3, value)),
    marker: (_, kind) => asNode(new Markup(8, kind)),
    fragment: () => asNode(new Markup(11)) as DocumentFragment,
    mount(_fiber, value, parent, before) {
      const tag = value.type as string;

      if (!TAG.test(tag)) throw new TypeError(`Invalid element name "${tag}".`);

      const element = new Markup(1, '', tag);

      element.svg = tag == 'svg' || inSvg(parent);
      return parent.insertBefore(asNode(element), before);
    },
    patch(fiber, value, appearance) {
      const element = asMarkup(fiber.start);
      const { tag } = element;
      const props = value.props as Record<string, any>;
      const resolved = appearance?.context?.resolve(props, tag);

      unmatched(value.source, props, [appearance?.context], appearance?.author, undefined, tag);

      for (const key of Object.keys(props))
        if (key[0] == '_') reserved(key);
        else if (!SKIPPED.has(key) && !/^on/i.test(key) && typeof props[key] != 'function' && !ATTRIBUTE.test(key))
          throw new TypeError(`Invalid attribute name "${key}".`);

      element.claimed = claim(sink, appearance, resolved, props.className, props.style);
      element.props = fiber.props = props;

      if (!opaque(tag, props))
        reconcileChildren(
          fiber,
          fiber.start,
          null,
          props.children,
          fiber.context,
          fiber.boundary,
          element.claimed.context || appearance?.author
            ? { author: appearance?.author, context: element.claimed.context, entries: [] }
            : undefined
        );
    },
    unmount() {},
    hoist: (value) => isVNode(value) && value.type === PORTAL ? vnode(PORTAL, { into: discard }, value.key) : value
  };

  return host;
}

function opaque(tag: string, props: Record<string, any>) {
  return 'dangerouslySetInnerHTML' in props
    || props.innerHTML != null
    || CONTENT.some((key) => props[key] != null)
    || tag == 'textarea' && (props.value ?? props.defaultValue) != null
    || RAW.has(tag);
}

/**
 * Render a node to markup and the style rules it emits, waiting on anything it suspends for.
 *
 * `new()` runs and is not awaited; effects and `ready` never do. Owned instances are destroyed once rendered.
 * A suspended render is awaited and retried in place; no fallback is drawn. Calls may run concurrently.
 * A `catch` boundary handles an error, then renders again; a retry that gets no further than the last passes the error out, and one no boundary handles rejects.
 * A portal leaves only its marker; `<title>`, `<meta>` and `<link>` go to `head`, as `render()` hoists them.
 */
async function renderToString(node: Node, options: Options = {}): Promise<Output> {
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
  const host = stringHost(sink);
  const container = fragment({ host } as Root);

  signal?.throwIfAborted();

  const unmount = await settled(node, container, host, signal);

  try {
    if (rules.length || roots.size) syncRoots(sink);

    const css = [...rules, ...roots.values()].filter(Boolean).join('\n');
    const pass: Pass = { sink, markers, head: [] };
    const html = serialize(asMarkup(container), pass);

    return { html, css, head: pass.head.join('') };
  } finally {
    unmount();
  }
}

interface Pass {
  sink: Styles;
  markers: boolean;
  head: string[];
  inHead?: boolean;
  selected?: string;
}

function serialize(node: Markup, pass: Pass): string {
  switch (node.nodeType) {
    case 3:
      return escape(node.nodeValue);
    case 8:
      return pass.markers ? `<!--${node.nodeValue}-->` : '';
    case 1:
      return hoisted(node, pass);
    default:
      return node.childNodes.map((child) => serialize(child, pass)).join('');
  }
}

function hoisted(node: Markup, pass: Pass) {
  if (!isHoisted(node.tag, node.props) || node.svg || pass.inHead) return element(node, pass);

  const markup = element(node, pass);

  if (node.tag == 'title') pass.head.unshift(markup);
  else pass.head.push(markup);

  return pass.markers ? '<!--portal-->' : '';
}

function element(node: Markup, pass: Pass) {
  const { tag, props, svg } = node;
  const { sink, selected } = pass;
  const claimed = node.claimed!;
  let attributes = '';

  for (const key of Object.keys(props)) {
    const next = props[key];

    if (key[0] == '_' || SKIPPED.has(key) || /^on/i.test(key) || typeof next == 'function') continue;
    if (key == 'value' || key == 'checked' || key == 'selected') continue;

    attributes += attribute(ALIASES[key] || (svg ? key : key.toLowerCase()), key, next);
  }

  if (claimed.className) attributes += ` class="${escape(claimed.className, true)}"`;

  const style = sink.serialize(sink.inline ? flatten(claimed) : claimed.declarations);

  if (style) attributes += ` style="${escape(style, true)}"`;

  const entry = props.value ?? props.defaultValue;
  const checked = props.checked ?? props.defaultChecked;

  if (tag != 'textarea' && tag != 'select') attributes += attribute('value', 'value', entry);
  attributes += attribute('checked', 'checked', checked);
  attributes += attribute('selected', 'selected', props.selected ?? (tag == 'option' && selected === String(props.value ?? childrenText(props.children)) || undefined));

  const open = `<${tag}${attributes}>`;

  if (VOID.has(tag) && !svg) return open;

  const content = CONTENT.find((key) => props[key] != null);
  let inner: string;

  if ('dangerouslySetInnerHTML' in props) inner = props.dangerouslySetInnerHTML?.__html || '';
  else if (props.innerHTML != null) inner = String(props.innerHTML);
  else if (content) inner = RAW.has(tag) ? raw(tag, String(props[content])) : escape(String(props[content]));
  else if (tag == 'textarea' && entry != null) inner = escape(String(entry));
  else if (RAW.has(tag)) inner = raw(tag, childrenText(props.children));
  else {
    const { inHead } = pass;

    if (tag == 'select' && entry != null) pass.selected = String(entry);
    if (tag == 'head') pass.inHead = true;

    inner = node.childNodes.map((child) => serialize(child, pass)).join('');
    Object.assign(pass, { inHead, selected });
  }

  if (tag == 'title' && !svg) inner = inner.replace(/<!--[^>]*-->/g, '');
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
