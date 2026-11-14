import type { Gate, Seat } from "./context";

export const RESERVED = new Set(["with", "then"]);

const GATE = Symbol("gate");

type Call = (...args: any[]) => unknown;

/** Calls by name, nested in groups and gated layers. */
export interface Tree {
  [name: string]: Call | Tree;
}

/**
 * A layer of calls behind a gate - the gate runs before every call within, root first.
 *
 * The gate is a function, whose activated Models are the call's own, or a Model class seated as the
 * layer's instance. A plain object nested in the tree adds a path segment without a gate. Throws if
 * a child is named `with` or `then`, which client nodes keep.
 *
 * @example
 * const api = route(Session, { claim: { search }, admin: route(Admin, { ban }) });
 */
export function route<T extends Tree>(gate: Seat | Gate, children: T): T {
  reserved(children);

  return Object.defineProperty({ ...children }, GATE, { value: gate });
}

export function reserved(tree: object, path: string[] = []) {
  for (const [key, value] of Object.entries(tree)) {
    if (RESERVED.has(key)) throw new Error(`${[...path, key].join(".")} is reserved for the client - name it otherwise.`);
    if (isNode(value)) reserved(value, [...path, key]);
  }
}

const isNode = (value: unknown): value is Tree => typeof value == "object" && value !== null;

const gateOf = (node: Tree): Seat | Gate | undefined => (node as { [GATE]?: Seat | Gate })[GATE];

const own = (node: Tree, key: string) => (Object.hasOwn(node, key) ? node[key] : undefined);

export function walk(tree: Tree, at: string[], name: string): { fn: Call; seats: (Seat | Gate | undefined)[] } | undefined {
  const seats = [gateOf(tree)];
  let node = tree;

  for (const part of at) {
    const next = own(node, part);

    if (!isNode(next)) return;

    seats.push(gateOf(next));
    node = next;
  }

  const fn = own(node, name);

  if (typeof fn == "function") return { fn, seats };
}
