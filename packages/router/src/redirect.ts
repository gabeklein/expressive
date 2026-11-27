const REDIRECT = Symbol.for('@expressive/router#redirect');
export const HOLD = Symbol.for('@expressive/router#hold-redirect');

/**
 * Thrown to navigate - the nearest Route catches it and goes to `to`.
 *
 * Throw while rendering or from a Component's `new()`, sync or async; elsewhere navigate with
 * `goto`. `to` resolves against the catching Route. History is replaced on a cold load, pushed during
 * in-app navigation. A render-time throw during a pushed navigation keeps the current screen until
 * the target is ready (dom; React 18+ concurrent roots); elsewhere the Route's `fallback` shows. An
 * async `new()` redirects after the page has shown. A redirect caught before the previous one lands
 * passes on as an error.
 *
 * @example
 * if (!session.user) throw new Redirect('/login');
 */
export class Redirect extends Error {
  constructor(readonly to: string) {
    super(`Redirect to ${to}`);
    this.name = 'Redirect';
    Object.defineProperty(this, REDIRECT, { value: true });
  }
}

export function isRedirect(error: unknown): error is Redirect {
  return !!(error as { [REDIRECT]?: boolean } | undefined)?.[REDIRECT];
}
