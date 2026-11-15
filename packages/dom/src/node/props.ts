const ALIASES: Record<string, string> = { autoFocus: 'autofocus', contentEditable: 'contenteditable', htmlFor: 'for' };
const ENUMERATED = ['contentEditable', 'contenteditable', 'draggable', 'spellcheck'];

function isEvent(key: string) {
  return /^on[A-Z]/.test(key);
}

function isStringified(key: string) {
  return key.startsWith('aria-') || key.startsWith('data-') || ENUMERATED.includes(key);
}

export { ALIASES, isEvent, isStringified };
