import type { Declaration } from './protocol';
import type { Styles } from './protocol';

interface Root {
  declarations: Declaration;
  when: readonly string[];
}

const groups = new Map<object, readonly Root[]>();
const synced = new WeakMap<Styles, number>();
let version = 0;

function rule(styles: Styles, { declarations, when }: Root) {
  const states = when.filter((condition) => condition[0] == ':').map((state) => `:is(${state})`).join('');
  const selector = `:where(:root${states})`;

  return when
    .filter((condition) => condition[0] == '@')
    .reduceRight((css, condition) => `${condition}{${css}}`, `${selector}{${styles.serialize(declarations)}}`);
}

function setRoot(key: object, roots: readonly Root[]) {
  groups.set(key, roots);
  version++;
}

function attachRoots(styles: Styles) {
  for (const [key, roots] of groups) {
    const declared = roots.filter((root) => Object.keys(root.declarations).length);

    styles.root(key, declared.map((root) => rule(styles, root)).join('\n'));
  }

  synced.set(styles, version);
}

/** Write pack root rules (variable defaults) to `styles` if any were declared since it last synced. */
function syncRoots(styles: Styles) {
  if (synced.get(styles) !== version) attachRoots(styles);
}

export { attachRoots, setRoot, syncRoots };
export type { Root };
