const ALIASES: Record<string, string> = {
  acceptCharset: 'accept-charset',
  autoFocus: 'autofocus',
  contentEditable: 'contenteditable',
  htmlFor: 'for',
  httpEquiv: 'http-equiv'
};
const ENUMERATED = ['contentEditable', 'contenteditable', 'draggable', 'spellcheck'];
const HOISTED = new Set(['title', 'meta', 'link']);

function isEvent(key: string) {
  return /^on[A-Z]/.test(key);
}

function isHoisted(type: unknown, props: Record<string, any>) {
  return HOISTED.has(type as string) && props.itemProp == null && props.itemprop == null;
}

function isStringified(key: string) {
  return key.startsWith('aria-') || key.startsWith('data-') || ENUMERATED.includes(key);
}

export { ALIASES, isEvent, isHoisted, isStringified };
