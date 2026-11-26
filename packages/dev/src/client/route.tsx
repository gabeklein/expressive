/** @jsxImportSource @expressive/jsx */

import { set, type Component } from "@expressive/mvc";
import { Route as Base, Redirect as RouterRedirect, fullPattern, matchPattern } from "@expressive/router";
import { Redirect } from "@expressive/rpc";
import { childrenOf, propsOf, typeOf } from "@expressive/jsx/jsx-runtime";
import { entering } from "./router";


type CatchUI = (props: { error: Error; retry: () => void }) => Component.Node;

type Verdict = string | void | null;

type EntryHook = (route: Route) => Verdict | Promise<Verdict>;

/**
 * Router's `Route` with a route module's exports - the generated tree builds one per module.
 *
 * Extend it for a class `Page`; the tree sets `enter`, `Catch` and `fallback`.
 */
export class Route extends Base {
  /** Shown while this route or a page below suspends on a cold load - the folder's `Loading`. Default none. */
  fallback: Component.Node = false;

  /**
   * Entry hook - a function `default` export, run with the Route before render.
   *
   * Generated function defaults reject returned strings. The internal gate check may still return a path.
   * A thrown error reaches `Catch`, whose `retry` checks again.
   */
  enter = set<EntryHook | undefined>(undefined, hook => arm(this, hook));

  /** Error UI for this route - `retry` re-renders the content. */
  Catch?: CatchUI = undefined;
}

const REFUSED = new Set<Route>();
const WATCHED = new WeakSet<Route>();
const REDIRECTING = new WeakSet<object>();

function arm(route: Route, hook: EntryHook | undefined) {
  const refused = (error: unknown) => {
    try {
      return redirected(error);
    } catch (error) {
      remember(route);
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

function remember(route: Route) {
  REFUSED.add(route);
  if (!WATCHED.has(route)) {
    WATCHED.add(route);
    route.set(null, () => void REFUSED.delete(route));
  }
}

export function report(route: Route, error: Error) {
  remember(route);
  route.redirect = () => { throw error; };
}

function redirected(error: unknown): string {
  const { status, location } = Object(error) as { status?: unknown; location?: unknown };

  if (typeof status == "number" && status >= 300 && status < 400 && typeof location == "string" && location) return location;

  throw error;
}

const { catch: redirect } = Base.prototype;

Object.defineProperty(Route.prototype, "catch", {
  get(this: Route) {
    const Boundary = this.Catch;

    const caught = (error: Error) => {
      if (typeof window === "undefined") return Promise.reject(error);
      if (!Boundary) return Promise.reject(error);
      return new Promise<void>(resolve => {
        const initial = this.fallback;
        const path = this.router.path;
        let done = false;
        let unwatch: () => boolean;
        const retry = () => {
          if (done) return;
          done = true;
          unwatch();
          REFUSED.forEach(route => arm(route, route.enter));
          REFUSED.clear();
          this.fallback = initial;
          resolve();
        };

        this.fallback = <Boundary error={error} retry={retry} />;
        unwatch = this.router.set("path", () => {
          if (this.router.path !== path) retry();
        });
        this.set(null, () => { unwatch(); });
      });
    };

    return (error: Error) => {
      if (error instanceof RouterRedirect || (error instanceof Redirect && error.location)) {
        const router = this.router.is;
        if (REDIRECTING.has(router)) return caught(error);
        if (typeof window === "undefined") {
          const moved = error instanceof RouterRedirect ? error : new RouterRedirect(error.location);
          return redirect.call(this, moved);
        }
        const to = error instanceof RouterRedirect ? error.to : error.location;
        let url: URL;
        try {
          url = new URL(this.resolve(to), window.location.href);
        } catch {
          return caught(error);
        }
        if (!/^https?:$/.test(url.protocol)) return caught(error);
        if (url.origin !== window.location.origin || !routed(this, url.pathname)) {
          window.location.assign(url.href);
          return new Promise<void>(() => {});
        }
        REDIRECTING.add(router);
        const moved = error instanceof RouterRedirect ? error : new RouterRedirect(error.location);
        return redirect.call(this, moved).finally(() => REDIRECTING.delete(router));
      }
      return caught(error);
    };
  }
});

function routed(route: Route, path: string): boolean {
  let root: Base = route;
  while (root.parent) root = root.parent;
  const visit = (children: unknown, base: string): boolean => childrenOf(children).some(node => {
    const props = propsOf(node);
    const Type = typeOf(node);
    if (!Base.is(Type)) return visit(props.children, base);
    if (props.none) return false;
    const pattern = fullPattern(base, String(props.to ?? ""));
    return (!!props.as && !props.children && !!matchPattern(pattern, path)) || visit(props.children, pattern);
  });
  return visit(root.props.children, "");
}
