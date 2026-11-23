import { documentOf } from '@expressive/jsx';
import type { Host } from '@expressive/jsx';

import { targetOf } from './document';
import { hoist } from './hoist';
import { hydration } from './hydrate';
import { locate, portaled } from './portal';
import { mountElement, patchProps, unmountElement } from './render/element';
import { stylesOf } from './style/facility';

const dom: Host = {
  target: targetOf,
  styles: stylesOf,
  text: (root, value) => documentOf(root.target!).createTextNode(value),
  marker: (root, kind) => documentOf(root.target!).createComment(kind),
  fragment: (root) => documentOf(root.target!).createDocumentFragment(),
  mount: mountElement,
  patch: patchProps,
  unmount: unmountElement,
  hoist,
  hydration,
  locate,
  portaled
};

export { dom };
