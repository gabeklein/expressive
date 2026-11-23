import { describe, expect, it, vi } from 'vitest';

import { mockError } from '../test.setup';

const error = mockError();

describe('copies', () => {
  it('will report a second copy once', async () => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('@expressive/jsx')];

    const first = await vi.importActual<typeof import('./copies')>('./copies');

    first.announce();
    first.announce();
    expect(error).not.toHaveBeenCalled();

    vi.resetModules();

    const second = await vi.importActual<typeof import('./copies')>('./copies');

    second.announce();
    second.announce();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('@expressive/jsx is loaded more than once');
  });
});
