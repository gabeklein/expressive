import { describe, expect, it } from 'vitest';

import { createStyleScope, resolveAppearance } from './appearance';
import { claim, placeComponent, flatten } from './claim';
import type { AppearanceContext, Styles } from './protocol';
import { style } from './stylesheet';

const sink: Styles = {
  open() {},
  live: () => true,
  insert() {},
  root() {},
  serialize: () => ''
};

const stylesOf = (_target: unknown) => sink;

style(function Emitting() {}, {});

describe('flatten', () => {
  it('will merge plain blocks by rank and order, then own declarations', () => {
    const plain = [
      [1, { declarations: { a: 1 }, ordinal: 0 }],
      [0, { declarations: { a: 2, b: 1 }, ordinal: 1 }],
      [0, { declarations: { b: 2 }, ordinal: 0 }]
    ];

    expect(flatten({ className: '', declarations: { color: 'red' }, plain } as any)).toEqual({ a: 1, b: 1, color: 'red' });
  });
});

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
    const first = placeComponent(Child, { _on: true }, appearance).props.style[0];

    expect(placeComponent(Child, { _on: true }, appearance).props.style[0]).toBe(first);
  });
});
