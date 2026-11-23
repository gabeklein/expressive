import { describe, it, expect } from 'vitest';

import { serialize } from './declarations';

describe('serialize', () => {
  it('will keep a var() shorthand beside its longhand', () => {
    expect(serialize(document, { margin: 'var(--gap) 1px', marginTop: '2px' }))
      .toBe('margin: var(--gap) 1px; margin-top: 2px;');
  });

  it('will skip a declaration the CSSOM rejects', () => {
    expect(serialize(document, { color: 'red', width: 'nonsense' })).toBe('color: red;');
  });
});
