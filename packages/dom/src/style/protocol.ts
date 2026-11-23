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
interface Sink {
  insert(rule: string, index: number): void;
  root(key: object, css: string): void;
  serialize(declarations: Declaration): string;
}

type StyleTarget = Document | ShadowRoot;
type Target = StyleTarget | Sink;

type Emit = (block: Block, depth: number, target: Target) => string;

const SUBCOMPONENT = /^_[A-Z]/;
const registrations = new WeakMap<object, EnterAppearance>();
const tokens = new WeakMap<object, ResolvedAppearance>();
const minted = new WeakMap<ResolvedAppearance, {}>();
let emitter: Emit | undefined;
const generations = new WeakMap<Target, number>();

function registerAppearance(type: object, enter: EnterAppearance) {
  registrations.set(type, enter);
}

function registerEmitter(emit: Emit) {
  emitter = emit;
}

function reopened(target: Target) {
  generations.set(target, sheetGeneration(target) + 1);
}

function sheetGeneration(target: Target) {
  return generations.get(target) || 0;
}

function emitClass(block: Block, depth: number, target: Target) {
  return emitter!(block, depth, target);
}

function isSink(target: Target): target is Sink {
  return 'insert' in target;
}

function documentOf(target: StyleTarget): Document {
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
  isSink,
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

export type { AppearanceContext, Block, Condition, Declaration, ResolvedAppearance, Sink, StyleTarget, Target };
