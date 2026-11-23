const ALIASES: Record<string, string> = {
  acceptCharset: 'accept-charset',
  autoFocus: 'autofocus',
  contentEditable: 'contenteditable',
  htmlFor: 'for',
  httpEquiv: 'http-equiv'
};
const ENUMERATED = ['contentEditable', 'contenteditable', 'draggable', 'spellcheck'];
const HOISTED = new Set(['title', 'meta', 'link']);
const SVG = 'http://www.w3.org/2000/svg';
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style']);
const BOOLEAN = new Set(
  ('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap ' +
  'itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected').split(' ')
);

function isEvent(key: string) {
  return /^on[A-Z]/.test(key);
}

function isHoisted(type: unknown, props: Record<string, any>) {
  return HOISTED.has(type as string) && props.itemProp == null && props.itemprop == null;
}

function isStringified(key: string) {
  return key.startsWith('aria-') || key.startsWith('data-') || ENUMERATED.includes(key);
}

export { ALIASES, BOOLEAN, RAW, SVG, VOID, isEvent, isHoisted, isStringified };
