import { describe, expect, it } from 'vitest';

import * as entry from './jsx-runtime';

describe('jsx-runtime module', () => {
  it('will carry only the seams hosts need from mvc', () => {
    expect(Object.keys(entry).sort()).toEqual(['elements', 'methodOf', 'resolver']);
  });
});
