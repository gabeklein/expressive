import { Model } from "@expressive/mvc";
import { BrowserRouter, Route } from "@expressive/router";
import { NotFound, Redirect } from "@expressive/rpc";

import { owns, report } from "./route";

const PATH = Symbol.for("@expressive/dev#path");

/** Run an entering route's default factory with its entering path available to calls during the synchronous run. */
export function entering<T>(path: string, run: () => T): T {
  if (typeof window == "undefined") return run();

  const shared = globalThis as Record<symbol, unknown>;
  const before = shared[PATH];

  shared[PATH] = path;

  try {
    return run();
  } finally {
    shared[PATH] = before;
  }
}


/** The app's `BrowserRouter` - `Router.get().navigating` is true while a navigation holds the current page. */
export class Router extends BrowserRouter {
  protected new() {
    const stop = Model.on({
      catch(this: Model, error, kind) {
        if (kind !== "setup" || !(error instanceof Redirect || error instanceof NotFound)) return error;
        let route = this instanceof Route ? this : this.get(Route, false);
        if (route && (!route.matched || owns(this))) return;
        if (error instanceof NotFound)
          while (route && !(route as Route & { Catch?: unknown }).Catch) route = route.parent;
        if (!route || route.router.is !== router) return error;
        if (error instanceof NotFound) report(route as Parameters<typeof report>[0], error);
        else void route.catch(error).catch(console.error);
      },
    });
    const router = this.is;
    const release = super.new();
    return () => { stop(); release?.(); };
  }

  protected next(url: string, replace?: boolean) {
    if (typeof window == "undefined") return Promise.resolve(this.locate(url));

    return super.next(url, replace);
  }

}
