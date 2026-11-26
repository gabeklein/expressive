import { appearanceToken, createAppearanceToken, emitClass, reserved, sheetGeneration } from './protocol';
import type { AppearanceContext, Block, ResolvedAppearance, Styles } from './protocol';
import { unmatched } from './diagnose';

type Style = string | Record<string, unknown> | false | null | undefined | readonly Style[];

/** Style context an element or component renders under: author, rules and forwarded `style`. */
interface Appearance {
  author?: object;
  context?: AppearanceContext;
  entries: Forwarded[];
  lexical?: AppearanceContext;
}

interface Forwarded {
  hops: number;
  style: Style;
}

interface Carried {
  appearance: ResolvedAppearance;
  doors: number;
}

interface Collected {
  classes: string[];
  declarations: Record<string, unknown>;
  tokens: Carried[];
}

/** An element's resolved styling: class names, inline declarations, and its children's rules. */
interface Claim {
  className: string;
  context?: AppearanceContext;
  declarations: Record<string, unknown>;
}

interface Claimed extends Claim {
  plain: [number, Block][];
}

interface Ticket {
  classes: string[];
  tokens: Carried[];
}

const tickets = new WeakMap<object, Ticket>();
const claims = new WeakMap<Styles, WeakMap<ResolvedAppearance, Claimed & { generation: number }>>();
const EMPTY: Claimed = { className: '', declarations: {}, plain: [] };

function componentProps(
  type: unknown,
  props: Record<string, any>,
  appearance: Appearance | undefined
) {
  const context = appearance?.context;

  for (const key of Object.keys(props)) reserved(key);

  if (!context || typeof type != 'function') return { appearance, props };

  const value = context.resolve(props);
  const { author, entries } = appearance!;

  if (!value) return { appearance: { author, entries, lexical: context }, props };

  return {
    appearance: { author, entries, lexical: value.context || context },
    props: { ...props, style: [createAppearanceToken(value), props.style] }
  };
}

function placed(appearance: Appearance | undefined): Appearance | undefined {
  return appearance && { entries: appearance.entries };
}

function door(value: Style) {
  const collected: Collected = { classes: [], declarations: {}, tokens: [] };
  const { classes, declarations, tokens } = collected;

  collect(value, collected, 1);

  if (!classes.length && !tokens.length && !Object.keys(declarations).length) return undefined;

  const key = Object.freeze({});

  tickets.set(key, { classes, tokens });
  return Object.freeze({ ...declarations, [Symbol('style')]: key });
}

function claim(
  styles: Styles,
  appearance: Appearance | undefined,
  resolved: ResolvedAppearance | undefined,
  className: unknown,
  value: Style
): Claimed {
  const entries = appearance?.entries || [];
  const context = resolved?.context || appearance?.context;
  const forwarded = entries.length || className || value;

  if (forwarded) return compose(styles, resolved, entries, className, value, context);
  if (!resolved) return { ...EMPTY, context };

  return reuse(styles, resolved, context);
}

function reuse(styles: Styles, resolved: ResolvedAppearance, context: AppearanceContext | undefined) {
  let byStyles = claims.get(styles);
  if (!byStyles) claims.set(styles, (byStyles = new WeakMap()));

  let known = byStyles.get(resolved);
  const first = resolved.blocks?.[0];

  // Reopens a removed stylesheet, so the generation below is current.
  if (known && first) emitClass(first, 0, styles);

  if (!known || known.generation !== sheetGeneration(styles)) {
    const fresh = compose(styles, resolved, [], undefined, undefined, context);
    byStyles.set(resolved, (known = { ...fresh, generation: sheetGeneration(styles) }));
  }

  return known;
}

function compose(
  styles: Styles,
  resolved: ResolvedAppearance | undefined,
  entries: Forwarded[],
  className: unknown,
  value: Style,
  context: AppearanceContext | undefined
): Claimed {
  const collected: Collected = { classes: [], declarations: {}, tokens: [] };

  if (resolved) collect(createAppearanceToken(resolved), collected, 0);
  appendClasses(collected.classes, className);
  collect(value, collected, 0);

  for (let index = entries.length - 1; index >= 0; index--)
    collect(entries[index].style, collected, entries[index].hops);

  const plain: [number, Block][] = [];

  for (const { appearance, doors } of collected.tokens) {
    for (const block of appearance.blocks || []) {
      collected.classes.push(emitClass(block, doors, styles));
      if (!block.group && !block.when?.length) plain.push([doors, block]);
    }
    if (appearance.classes) collected.classes.push(...appearance.classes);
  }

  return {
    className: [...new Set(collected.classes)].join(' '),
    context,
    declarations: collected.declarations,
    plain
  };
}

/**
 * Style an intrinsic element: its rule classes and declarations, and the appearance its children render under.
 *
 * Warns in dev for a `_flag` no rule matches, and throws for a reserved `_Name` key.
 * `dev` is the element's dev source - without one, nothing warns.
 */
function styleElement(styles: Styles, type: string, props: Record<string, any>, appearance?: Appearance, dev?: object) {
  const resolved = appearance?.context?.resolve(props, type);

  unmatched(dev, props, [appearance?.context], appearance?.author, undefined, type);

  for (const key in props)
    if (key[0] == '_') reserved(key);

  const claimed = claim(styles, appearance, resolved, props.className, props.style);
  const inner: Appearance | undefined = claimed.context || appearance?.author
    ? { author: appearance?.author, context: claimed.context, entries: [] }
    : undefined;

  return { claim: claimed as Claim, inner };
}

/** A claim's declarations with its unconditional rule declarations folded in, for inline output. Takes claims the core made - `fiber.claimed` after a styled patch. */
function flatten(claimed: Claim) {
  const { declarations, plain } = claimed as Claimed;

  return Object.assign(
    {},
    ...[...plain]
      .sort(([a, x], [b, y]) => a - b || x.ordinal - y.ordinal)
      .map(([, block]) => block.declarations),
    declarations
  ) as Record<string, unknown>;
}


function collect(value: Style, collected: Collected, doors: number) {
  if (!value) return;

  const token = appearanceToken(value);
  if (token) {
    collected.tokens.push({ appearance: token, doors });
    Object.assign(collected.declarations, token.declarations);
    return;
  }

  if (typeof value == 'string') {
    appendClasses(collected.classes, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collect(entry, collected, doors));
    return;
  }

  for (const symbol of Object.getOwnPropertySymbols(value)) {
    const ticket = tickets.get((value as Record<symbol, object>)[symbol]);
    if (!ticket) continue;

    collected.classes.push(...ticket.classes);
    for (const carried of ticket.tokens)
      collected.tokens.push({ appearance: carried.appearance, doors: carried.doors + doors });
  }

  for (const key of Object.keys(value)) collected.declarations[key] = (value as Record<string, unknown>)[key];
}

function appendClasses(classes: string[], value: unknown) {
  if (typeof value == 'string') classes.push(...value.split(/\s+/).filter(Boolean));
}

export { claim, componentProps, door, flatten, placed, styleElement };
export type { Appearance, Claim, Style };
