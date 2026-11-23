import { describe, expect, it, vi } from 'vitest';

import { mockError } from '../test.setup';

const error = mockError();
const COPIES = Symbol.for('@expressive/jsx');

async function fresh() {
  vi.resetModules();
  return vi.importActual<typeof import('./copies')>('./copies');
}

describe('copies', () => {
  it('will not report the same module evaluated again', async () => {
    delete (globalThis as Record<symbol, unknown>)[COPIES];

    (await fresh()).announce();
    (await fresh()).announce();

    expect(error).not.toHaveBeenCalled();
  });

  it('will report a second copy once', async () => {
    (globalThis as Record<symbol, unknown>)[COPIES] = ['file:///elsewhere/jsx/dist/index.js'];

    const copy = await fresh();

    copy.announce();
    copy.announce();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('@expressive/jsx is loaded more than once');
  });
});
