import { serialize } from './declarations';
import { documentOf } from './protocol';
import type { Styles, StyleTarget } from './protocol';

const known = new WeakMap<StyleTarget, Styles>();
const roots = new WeakMap<Document, Map<object, HTMLStyleElement>>();

function stylesOf(target: StyleTarget): Styles {
  let styles = known.get(target);

  if (!styles) known.set(target, (styles = target.nodeType == 9 ? sheet(target as Document) : adopted(target as ShadowRoot)));

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

  element.textContent = css;
}

export { stylesOf };
