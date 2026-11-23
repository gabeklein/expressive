import { documentOf } from '@expressive/jsx';
import type { Claim, Declaration, Styles, StyleTarget } from '@expressive/jsx';

const known = new WeakMap<StyleTarget, Styles>();
const roots = new WeakMap<Document, Map<object, HTMLStyleElement>>();

function stylesOf(target: StyleTarget): Styles {
  let styles = known.get(target);

  if (!styles) {
    const isDocument = target.nodeType == 9;

    styles = isDocument ? sheet(target as Document) : adopted(target as ShadowRoot);
    known.set(target, styles);
  }

  return styles;
}

function sheet(document: Document): Styles {
  let element: HTMLStyleElement | undefined;

  return {
    open() {
      element = document.createElement('style');
      element.dataset.expressive = 'dom';
      document.head.append(element);
    },
    live: () => !!element?.sheet,
    insert: (rule, index) => element!.sheet!.insertRule(rule, index),
    root: (key, css) => root(document, key, css),
    serialize: (declarations) => serialize(document, declarations)
  };
}

function adopted(shadow: ShadowRoot): Styles {
  const document = documentOf(shadow);
  let sheet: CSSStyleSheet | undefined;

  return {
    open() {
      sheet = new (document.defaultView!.CSSStyleSheet)();
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
    },
    live: () => !!sheet && shadow.adoptedStyleSheets.includes(sheet),
    insert: (rule, index) => sheet!.insertRule(rule, index),
    root: (key, css) => root(document, key, css),
    serialize: (declarations) => serialize(document, declarations)
  };
}

function root(document: Document, key: object, css: string) {
  let elements = roots.get(document);
  if (!elements) roots.set(document, (elements = new Map()));

  let element = elements.get(key);

  if (!element?.isConnected) {
    element = document.createElement('style');
    element.dataset.expressive = 'root';
    document.head.append(element);
    elements.set(key, element);
  }

  if (element.textContent !== css) element.textContent = css;
}

function applyDeclarations(style: CSSStyleDeclaration, declarations: Declaration, previous: Declaration = {}) {
  const target = style as any;

  for (const key of Object.keys({ ...previous, ...declarations })) {
    const value = declarations[key];
    if (key.startsWith('--')) {
      style.setProperty(key, value == null ? '' : String(value));
      continue;
    }

    if (typeof value == 'number') target[key] = '';
    target[key] = value == null ? '' : value;
    if (typeof value == 'number' && value !== 0 && !target[key]) target[key] = `${value}px`;
  }
}

function serialize(document: Document, declarations: Declaration) {
  const value = document.createElement('div').style;

  return Object.keys(declarations).map((key) => {
    value.cssText = '';
    applyDeclarations(value, { [key]: declarations[key] });
    return value.cssText;
  }).filter(Boolean).join(' ');
}

function applyClaim(element: Element, before: Claim | undefined, after: Claim) {
  const previous = before || { className: '', declarations: {} };

  if (previous.className !== after.className) {
    if (after.className) element.setAttribute('class', after.className);
    else element.removeAttribute('class');
  }

  applyDeclarations((element as HTMLElement).style, after.declarations, previous.declarations);
}

export { applyClaim, applyDeclarations, serialize, stylesOf };
