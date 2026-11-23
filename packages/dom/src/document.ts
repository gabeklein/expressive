import { activeRoot, documentOf } from '@expressive/jsx';
import type { StyleTarget } from '@expressive/jsx';

/** A container's style target - its shadow root, else its document. */
function targetOf(container: globalThis.Node): StyleTarget {
  const root = container.getRootNode();

  return root.nodeType == 9 || isShadowRoot(root) ? root as StyleTarget : container.ownerDocument!;
}

function isShadowRoot(node: globalThis.Node): node is ShadowRoot {
  return node.nodeType == 11 && 'host' in node;
}

/** The document the rendering root lives in. */
function activeDocument() {
  return documentOf(activeRoot().container);
}

export { activeDocument, isShadowRoot, targetOf };
