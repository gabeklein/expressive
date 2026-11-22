type StyleTarget = Document | ShadowRoot;

let current: StyleTarget | undefined;

function targetOf(container: globalThis.Node): StyleTarget {
  const root = container.getRootNode();

  return root instanceof ShadowRoot || root.nodeType == 9 ? root as StyleTarget : container.ownerDocument!;
}

function within<T>(target: StyleTarget | undefined, run: () => T): T {
  const previous = current;
  current = target;

  try {
    return run();
  } finally {
    current = previous;
  }
}

function activeTarget() {
  return current;
}

export { activeTarget, targetOf, within };
export type { StyleTarget };
