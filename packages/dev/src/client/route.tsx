/** @jsxImportSource @expressive/jsx */

import { set, type Component } from "@expressive/mvc";
import { Route as Base } from "@expressive/router";

type CatchUI = (props: { error: Error; retry: () => void }) => Component.Node;

type Verdict = string | void | null;

type EntryHook = (route: Route) => Verdict | Promise<Verdict>;

/**
 * Router's `Route` with a route module's exports - the generated tree builds one per module.
 *
 * Extend it for a class `Page`; the tree sets `enter`, `Catch`, `NotFound` and `fallback`.
 */
export class Route extends Base {
  /** Shown while this route or a page below suspends on a cold load - the folder's `Loading`. Default none. */
  fallback: Component.Node = false;

  /**
   * Entry hook - a function `default` export, run with the Route before render.
   *
   * A returned string redirects and `null` falls through to the 404. It may be async.
   * A thrown error with a 3xx `status` and a `location` redirects there; any other reaches `Catch`.
   */
  enter = set<EntryHook | undefined>(undefined, hook => {
    this.redirect = hook && (() => {
      try {
        const verdict = hook(this);

        return verdict instanceof Promise ? verdict.catch(redirected) : verdict;
      } catch (error) {
        return redirected(error);
      }
    });
  });

  /** Error UI for this route - `retry` re-renders the content. */
  Catch?: CatchUI = undefined;

  /** Rendered for a path under this route that no child matches. */
  NotFound?: (props: { children?: Component.Node }) => Component.Node = undefined;

  protected get children(): Component.Node {
    const children = super.children;
    if (!this.NotFound) return children;

    return (
      <>
        {children}
        <Route none as={this.NotFound} fallback={null} />
      </>
    );
  }
}

function redirected(error: unknown): string {
  const { status, location } = Object(error) as { status?: unknown; location?: unknown };

  if (typeof status == "number" && status >= 300 && status < 400 && typeof location == "string" && location) return location;

  throw error;
}

Object.defineProperty(Route.prototype, "catch", {
  get(this: Route) {
    const Boundary = this.Catch;

    if (!Boundary) return undefined;

    return (error: Error) => new Promise<void>(retry => {
      this.fallback = <Boundary error={error} retry={retry} />;
    });
  }
});
