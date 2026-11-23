import { documentOf } from '../style/protocol';
import type { StyleTarget } from '../style/protocol';
import { syncRoots } from '../style/root';

let current: StyleTarget | undefined;

function targetOf(container: globalThis.Node): StyleTarget {
  const root = container.getRootNode();

  return root.nodeType == 9 || isShadowRoot(root) ? root as StyleTarget : container.ownerDocument!;
}

function isShadowRoot(node: globalThis.Node): node is ShadowRoot {
  return node.nodeType == 11 && 'host' in node;
}

function within<T>(target: StyleTarget, run: () => T): T {
  const previous = current;
  current = target;

  syncRoots(target);

  try {
    return run();
  } finally {
    current = previous;
  }
}

function activeTarget() {
  return current;
}

function activeDocument() {
  return documentOf(current!);
}

export { activeDocument, activeTarget, isShadowRoot, targetOf, within };
