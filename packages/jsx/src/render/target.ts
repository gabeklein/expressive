import { syncRoots } from '../style/root';
import type { Root } from './host';

let current: Root | undefined;

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

export { activeRoot, within };
