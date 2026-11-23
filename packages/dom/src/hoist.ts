import { LEAD, PORTAL, activeDocument, hostOf, isShadowRoot, isVNode, vnode } from '@expressive/jsx';
import type { RenderNode } from '@expressive/jsx';

import { SVG, isHoisted } from './tags';

/** Send a top-level `<title>`, `<meta>` or `<link>` to the document head, as a portal. */
function hoist(value: RenderNode, parent: globalThis.Node): RenderNode {
  if (!isVNode(value) || !isHoisted(value.type, value.props)) return value;

  const host = hostOf(parent) as Element;

  if (host.closest?.('head') || isShadowRoot(host.getRootNode())) return value;
  if (host.namespaceURI == SVG && host.localName != 'foreignObject') return value;

  return vnode(PORTAL, { into: activeDocument().head, children: value, [LEAD]: value.type == 'title' }, value.key);
}

export { hoist };
