import { syncRoots } from '../style/root';
import type { StyleTarget } from '../style/protocol';

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

export { activeTarget, isShadowRoot, targetOf, within };
