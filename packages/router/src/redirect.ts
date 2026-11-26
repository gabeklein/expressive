/**
 * Thrown to navigate elsewhere - the nearest Route catches it and goes to `to`.
 *
 * Throw while rendering or from a Component's `new()`, sync or async. `to` resolves against the
 * catching Route. History is replaced when the URL being left is the committed entry (a cold load),
 * pushed during a navigation. The current screen stays up until the target is ready. A second
 * redirect caught before the first lands passes on as an error.
 *
 * @example
 * if (!this.session.user) throw new Redirect('/login');
 */
export class Redirect extends Error {
  constructor(readonly to: string) {
    super(`Redirect to ${to}`);
    this.name = 'Redirect';
  }
}
