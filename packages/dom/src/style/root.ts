import { serialize } from './declarations';
import type { Declaration } from './declarations';
import { documentOf, isSink } from './protocol';
import type { Sink, StyleTarget } from './protocol';

interface Root {
  declarations: Declaration;
  when: readonly string[];
}

const groups = new Map<object, readonly Root[]>();
const elements = new WeakMap<Document, Map<object, HTMLStyleElement>>();
const synced = new WeakMap<Document, number>();
let version = 0;

function rule(target: Document | Sink, { declarations, when }: Root) {
  const states = when.filter((condition) => condition[0] == ':').map((state) => `:is(${state})`).join('');
  const selector = `:where(:root${states})`;

  return when
    .filter((condition) => condition[0] == '@')
    .reduceRight((css, condition) => `${condition}{${css}}`, `${selector}{${serialize(target, declarations)}}`);
}

function write(target: Document | Sink, key: object) {
  const css = groups.get(key)!
    .filter((root) => Object.keys(root.declarations).length)
    .map((root) => rule(target, root))
    .join('\n');

  if (isSink(target)) return target.root(key, css);

  let known = elements.get(target);
  if (!known) elements.set(target, (known = new Map()));

  let element = known.get(key);

  if (!element?.isConnected) {
    element = target.createElement('style');
    element.dataset.expressive = 'root';
    target.head.append(element);
    known.set(key, element);
  }

  element.textContent = css;
}

function setRoot(key: object, roots: readonly Root[]) {
  groups.set(key, roots);
  version++;
}

function attachRoots(target: Document | Sink) {
  for (const key of groups.keys()) write(target, key);
  if (!isSink(target)) synced.set(target, version);
}

function syncRoots(target: StyleTarget) {
  const document = documentOf(target);

  if (synced.get(document) !== version) attachRoots(document);
}

export { attachRoots, setRoot, syncRoots };
export type { Root };
