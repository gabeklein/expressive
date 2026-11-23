type Declaration = Record<string, unknown>;

interface Block {
  declarations: Declaration;
  group?: true;
  name: string;
  ordinal: number;
  when?: readonly Condition[];
}

type Condition = string | { on: Block; state: string };

interface ResolvedAppearance {
  blocks?: Block[];
  classes?: string[];
  context?: AppearanceContext;
  declarations?: Declaration;
}

interface AppearanceContext {
  readonly scope?: unknown;
  readonly base?: object;
  resolve(
    props: Record<string, unknown>,
    tag?: string
  ): ResolvedAppearance | undefined;
}

type EnterAppearance = (parent?: AppearanceContext, key?: string, defines?: boolean) => AppearanceContext | undefined;
/** Where a root's rules go - a document's sheet, a shadow root's, or a server sink. */
interface Styles {
  /** Open a fresh sheet - on first use, and after `live()` turns false. */
  open(): void;
  live(): boolean;
  insert(rule: string, index: number): void;
  /** Write a pack's root rules (custom property defaults). */
  root(key: object, css: string): void;
  serialize(declarations: Declaration): string;
  /** Name rules by content, so names never collide with another sheet's. */
  hashed?: boolean;
  /** Write an element's unconditional rules into its `style` attribute. */
  inline?: boolean;
}

type StyleTarget = Document | ShadowRoot;

type Emit = (block: Block, depth: number, styles: Styles) => string;

const SUBCOMPONENT = /^_[A-Z]/;
const registrations = new WeakMap<object, EnterAppearance>();
const tokens = new WeakMap<object, ResolvedAppearance>();
const minted = new WeakMap<ResolvedAppearance, {}>();
let emitter: Emit | undefined;
const generations = new WeakMap<Styles, number>();

function registerAppearance(type: object, enter: EnterAppearance) {
  registrations.set(type, enter);
}

function registerEmitter(emit: Emit) {
  emitter = emit;
}

function reopened(styles: Styles) {
  generations.set(styles, sheetGeneration(styles) + 1);
}

function sheetGeneration(styles: Styles) {
  return generations.get(styles) || 0;
}

function emitClass(block: Block, depth: number, styles: Styles) {
  return emitter!(block, depth, styles);
}

function documentOf(target: globalThis.Node): Document {
  return target.nodeType == 9 ? target as Document : target.ownerDocument!;
}

function enterAppearance(type: Function, key?: string, parent?: AppearanceContext) {
  const chain: [EnterAppearance, boolean][] = [];
  let current: any = type;
  let found = !key;

  while (current && current !== Function.prototype) {
    const enter = registrations.get(current);
    const defines = !found && Object.hasOwn(current.prototype, key!);

    if (defines) found = true;
    if (enter) chain.unshift([enter, defines]);
    current = Object.getPrototypeOf(current);
  }

  for (const [enter, defines] of chain) parent = enter(parent, key, defines);
  return parent;
}

function reserved(key: string) {
  if (SUBCOMPONENT.test(key))
    throw new Error(`"${key}" is reserved for subcomponents in style() maps.`);
}

function createAppearanceToken(appearance: ResolvedAppearance) {
  let token = minted.get(appearance);
  if (token) return token;
  token = {};
  tokens.set(token, appearance);
  minted.set(appearance, token);
  return token;
}

function appearanceToken(value: unknown) {
  return value && typeof value == 'object' ? tokens.get(value) : undefined;
}

export {
  appearanceToken,
  documentOf,
  createAppearanceToken,
  emitClass,
  enterAppearance,
  registerAppearance,
  registerEmitter,
  reopened,
  reserved,
  sheetGeneration,
  SUBCOMPONENT
};

export type { AppearanceContext, Block, Condition, Declaration, ResolvedAppearance, Styles, StyleTarget };
