import { documentOf } from '../style/protocol';
import type { StyleTarget } from '../style/protocol';
import { syncRoots } from '../style/root';
import type { Root } from './host';

let current: Root | undefined;

function targetOf(container: globalThis.Node): StyleTarget {
  const root = container.getRootNode();

  return root.nodeType == 9 || isShadowRoot(root) ? root as StyleTarget : container.ownerDocument!;
}

function isShadowRoot(node: globalThis.Node): node is ShadowRoot {
  return node.nodeType == 11 && 'host' in node;
}

function within<T>(root: Root, run: () => T): T {
  const previous = current;
  current = root;

  if (root.styles) syncRoots(root.styles);

  try {
    return run();
  } finally {
    current = previous;
  }
}

function activeRoot() {
  return current!;
}

function activeDocument() {
  return documentOf(current!.target || current!.container);
}

export { activeDocument, activeRoot, isShadowRoot, targetOf, within };
