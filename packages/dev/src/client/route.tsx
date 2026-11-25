/** @jsxImportSource @expressive/mvc */

import { set, type Component } from "@expressive/mvc";
import { Route as Base } from "@expressive/router";

import { entering } from "./router";

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
   * A thrown error with a 3xx `status` and a `location` redirects there; any other reaches `Catch`, whose `retry` runs the hook again.
   */
  enter = set<EntryHook | undefined>(undefined, hook => arm(this, hook));

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

const REFUSED = new Set<Route>();
const WATCHED = new WeakSet<Route>();

function arm(route: Route, hook: EntryHook | undefined) {
  const refused = (error: unknown) => {
    try {
      return redirected(error);
    } catch (error) {
      REFUSED.add(route);

      if (!WATCHED.has(route)) {
        WATCHED.add(route);
        route.set(null, () => void REFUSED.delete(route));
      }

      throw error;
    }
  };

  const enter = (run: EntryHook) => entering(route.router.path, () => run(route));

  route.redirect = hook && (() => {
    try {
      const verdict = enter(hook);

      return verdict instanceof Promise ? verdict.then(next => (typeof next == "function" ? enter(next as EntryHook) : next)).catch(refused) : verdict;
    } catch (error) {
      return refused(error);
    }
  });
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

    return (error: Error) => new Promise<void>(resolve => {
      const retry = () => {
        REFUSED.forEach(route => arm(route, route.enter));
        REFUSED.clear();
        resolve();
      };

      this.fallback = <Boundary error={error} retry={retry} />;
    });
  }
});
