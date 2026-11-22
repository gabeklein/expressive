import { serialize } from './declarations';
import type { Declaration } from './declarations';
import { documentOf, isSink } from './protocol';
import type { Target } from './protocol';

interface Root {
  declarations: Declaration;
  when: readonly string[];
}

const groups = new Map<object, readonly Root[]>();
const elements = new WeakMap<Document, Map<object, HTMLStyleElement>>();
const synced = new WeakMap<Document, number>();
let version = 0;

function rule(target: Target, { declarations, when }: Root) {
  const states = when.filter((condition) => condition[0] == ':').map((state) => `:is(${state})`).join('');
  const selector = `:where(:root${states})`;

  return when
    .filter((condition) => condition[0] == '@')
    .reduceRight((css, condition) => `${condition}{${css}}`, `${selector}{${serialize(target, declarations)}}`);
}

function write(target: Target, key: object) {
  const css = groups.get(key)!
    .filter((root) => Object.keys(root.declarations).length)
    .map((root) => rule(target, root))
    .join('\n');

  if (isSink(target)) return target.root(key, css);

  const document = target as Document;
  let known = elements.get(document);
  if (!known) elements.set(document, (known = new Map()));

  let element = known.get(key);

  if (!element?.isConnected) {
    element = document.createElement('style');
    element.dataset.expressive = 'root';
    document.head.append(element);
    known.set(key, element);
  }

  element.textContent = css;
}

function setRoot(key: object, roots: readonly Root[]) {
  groups.set(key, roots);
  version++;
}

function attachRoots(target: Target) {
  const into = isSink(target) ? target : documentOf(target);

  for (const key of groups.keys()) write(into, key);
  if (!isSink(into)) synced.set(into, version);
}

function syncRoots(target: Target) {
  if (!isSink(target) && synced.get(documentOf(target)) !== version) attachRoots(target);
}

export { attachRoots, setRoot, syncRoots };
export type { Root };
