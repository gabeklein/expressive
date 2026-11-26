import { describe, expect, it } from 'vitest';

import { documentOf } from './protocol';

describe('documentOf', () => {
  it('will return a document as its own', () => {
    const other = document.implementation.createHTMLDocument();

    expect(documentOf(other)).toBe(other);
    expect(documentOf(other.body)).toBe(other);
  });
});
