import { describe, expect, it } from 'vitest';

import * as entry from './host';

describe('host module', () => {
  it('will carry only the seams hosts need from mvc', () => {
    expect(Object.keys(entry).sort()).toEqual(['elements', 'methodOf', 'resolver']);
  });
});
