import { hydrate as hydrateWith, render as renderWith } from '@expressive/jsx';
import type { Container, RenderNode } from '@expressive/jsx';

import { dom } from './host';

/**
 * Mount a node into a container and return its unmount.
 *
 * Replaces the container's children and any root rendered there before. Unmount is idempotent.
 * A throw during the first render unmounts what it built, then propagates.
 */
function render(node: RenderNode, container: Container): () => void {
  return renderWith(node, container, dom);
}

/**
 * Mount a node over `renderToString` markup in the container, adopting its nodes.
 *
 * Nodes the render does not claim are removed.
 * Mismatched nodes are replaced where they differ. A subtree that suspends keeps its server markup until it renders.
 * Returns the unmount, as `render()` does.
 */
function hydrate(node: RenderNode, container: Container): () => void {
  return hydrateWith(node, container, dom);
}

export { hydrate, render };
