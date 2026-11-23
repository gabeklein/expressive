import type { Claim, Declaration } from '@expressive/jsx';

function applyDeclarations(style: CSSStyleDeclaration, declarations: Declaration, previous: Declaration = {}) {
  const target = style as any;

  for (const key of Object.keys({ ...previous, ...declarations })) {
    const value = declarations[key];
    if (key.startsWith('--')) {
      style.setProperty(key, value == null ? '' : String(value));
      continue;
    }

    if (typeof value == 'number') target[key] = '';
    target[key] = value == null ? '' : value;
    if (typeof value == 'number' && value !== 0 && !target[key]) target[key] = `${value}px`;
  }
}

function serialize(document: Document, declarations: Declaration) {
  const value = document.createElement('div').style;

  return Object.keys(declarations).map((key) => {
    value.cssText = '';
    applyDeclarations(value, { [key]: declarations[key] });
    return value.cssText;
  }).filter(Boolean).join(' ');
}

function applyClaim(element: Element, before: Claim | undefined, after: Claim) {
  const previous = before || { className: '', declarations: {} };

  if (previous.className !== after.className) {
    if (after.className) element.setAttribute('class', after.className);
    else element.removeAttribute('class');
  }

  applyDeclarations((element as HTMLElement).style, after.declarations, previous.declarations);
}

export { applyClaim, applyDeclarations, serialize };
