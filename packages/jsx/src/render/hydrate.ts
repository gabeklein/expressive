import type { Fiber } from './fiber';
import { activeRoot } from './target';

type Node = globalThis.Node;

/**
 * How a host adopts existing markup instead of creating nodes - dom's hydration.
 *
 * Without one, every node is created and inserted.
 */
interface Hydration {
  /** Place a node at `parent` before `before` - an existing one `match` accepts, else `create()`. */
  adopt<T extends Node>(parent: Node, before: Node | null, create: () => T, match: (node: Node) => boolean): T;
  /** True for a node `adopt` took from existing markup. */
  adopted(node: Node): boolean;
  /** Place a text node, adopting one that holds `value`. */
  adoptText(parent: Node, before: Node | null, value: string): Node;
  /** Place a range's start and end markers. */
  adoptRange(parent: Node, before: Node | null, kind: string): [Node, Node];
  /** Run `work` creating nodes, not adopting them. */
  aside<T>(work: () => T): T;
  /**
   * Run `work` adopting what is under `root`, then remove what went unadopted.
   *
   * On resume, `from` and `to` are a kept range's own markers, and only nodes between them are claimed or removed.
   */
  hydrating<T>(root: Node, work: () => T, from?: Node | null, to?: Node | null): T;
  /**
   * Keep a suspended range's existing markup until it renders. True if there was some.
   *
   * A `true` commits the hydration to a later `hydrating(parent, work, start, end)` for that range.
   */
  keep(start: Node, end: Node): boolean;
  /** Leave a range alone when cleaning up unadopted nodes. */
  reserve(start: Node, end: Node): void;
}

function text(value: string) {
  const root = activeRoot();
  return root.host.text(root, value);
}

function marker(kind: string) {
  const root = activeRoot();
  return root.host.marker(root, kind);
}

function isComment(node: Node, data: string) {
  return node.nodeType == 8 && (node as Comment).data == data;
}

const plain: Omit<Hydration, 'adopted' | 'hydrating'> = {
  adopt: (parent, before, create) => parent.insertBefore(create(), before),
  adoptText: (parent, before, value) => parent.insertBefore(text(value), before),
  adoptRange(parent, before, kind) {
    const start = parent.insertBefore(marker(kind), before);
    return [start, parent.insertBefore(marker(`/${kind}`), before)];
  },
  aside: (work) => work(),
  keep: () => false,
  reserve() {}
};

function hydrationOf() {
  return activeRoot().host.hydration || plain;
}

function resume<T>(fiber: Fiber, work: () => T): T {
  return fiber.root!.host.hydration!.hydrating(fiber.end.parentNode!, work, fiber.start, fiber.end);
}

export { hydrationOf, isComment, marker, resume, text };
export type { Hydration };
