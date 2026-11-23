import { describe, expect, it } from 'vitest';

import { createStyleScope, resolveAppearance } from './appearance';
import { claim, componentProps } from './claim';
import type { AppearanceContext } from './protocol';
import { style } from './stylesheet';
import { stylesOf } from '@expressive/dom/style/facility';

style(function Emitting() {}, {});

describe('claim reuse', () => {
  const scope = createStyleScope(undefined, { _on: { color: 'red' } })!;
  const resolved = resolveAppearance(scope, { _on: true })!;
  const context = { resolve: () => resolved } as unknown as AppearanceContext;

  it('will reuse a claim with nothing forwarded', () => {
    const first = claim(stylesOf(document), { entries: [], context }, resolved, undefined, undefined);

    expect(claim(stylesOf(document), { entries: [], context }, resolved, undefined, undefined)).toBe(first);
    expect(first.context).toBe(context);
  });

  it('will not reuse a claim carrying a className', () => {
    const first = claim(stylesOf(document), { entries: [], context }, resolved, 'extra', undefined);

    expect(first.className).toContain('extra');
    expect(claim(stylesOf(document), { entries: [], context }, resolved, 'extra', undefined)).not.toBe(first);
  });

  it('will mint one token per resolved appearance', () => {
    const Child = () => null;
    const appearance = { entries: [], context };
    const first = componentProps(Child, { _on: true }, appearance).props.style[0];

    expect(componentProps(Child, { _on: true }, appearance).props.style[0]).toBe(first);
  });
});
