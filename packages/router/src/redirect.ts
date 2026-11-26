/**
 * Thrown to navigate - the nearest Route catches it and goes to `to`.
 *
 * Throw while rendering or from a Component's `new()`, sync or async; elsewhere navigate with
 * `goto`. `to` resolves against the catching Route. History is replaced on a cold load, pushed during
 * in-app navigation. A render-time throw shows the Route's `fallback` until the target is ready. A
 * redirect caught before the previous one lands passes on as an error.
 *
 * @example
 * if (!session.user) throw new Redirect('/login');
 */
export class Redirect extends Error {
  constructor(readonly to: string) {
    super(`Redirect to ${to}`);
    this.name = 'Redirect';
  }
}
