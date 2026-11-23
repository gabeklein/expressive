import { LEAD, activeDocument } from '@expressive/jsx';
import type { Container, Fiber } from '@expressive/jsx';

const hoisted = new WeakSet<globalThis.Node>();

function replace(fiber: Fiber, adopting: boolean) {
  const element = fiber.children[0].start as Element;

  hoisted.add(element);

  if (adopting)
    for (const twin of fiber.portalContainer!.children)
      if (!hoisted.has(twin) && twin.outerHTML == element.outerHTML) return retire(twin, element);
}

function retire(twin: Element, element: Element) {
  if (!/\bstylesheet\b/i.test(String(element.getAttribute('rel')))) return twin.remove();

  const remove = () => twin.remove();

  element.addEventListener('load', remove, { once: true });
  element.addEventListener('error', remove, { once: true });
}

function locate(into: string, parent: globalThis.Node): Container {
  const root = parent.getRootNode();
  const found = [...activeDocument().querySelectorAll(into)];

  if (root.nodeType == 11) found.push(...(root as DocumentFragment).querySelectorAll(into));

  if (found.length != 1)
    throw new Error(`Portal target "${into}" ${found.length ? 'is ambiguous' : 'was not found'}.`);

  return found[0];
}

/** Retire the server's copy of a hoisted head element once the client's mounts over it. */
function portaled(fiber: Fiber, adopting: boolean) {
  if (LEAD in fiber.props!) replace(fiber, adopting);
}

export { locate, portaled };
