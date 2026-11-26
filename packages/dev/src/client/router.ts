import { BrowserRouter } from "@expressive/router";

const PATH = Symbol.for("@expressive/dev#path");
const ACTIVE = Symbol.for("@expressive/dev#router");

/** Run an entering route's entry hook with the path it enters left for the call module, for the hook's synchronous run. */
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
    const release = super.new();
    if (typeof window === "undefined") return release;

    const shared = globalThis as Record<symbol, unknown>;
    const before = shared[ACTIVE];
    shared[ACTIVE] = this;

    return () => {
      shared[ACTIVE] = before;
      release?.();
    };
  }

  protected next(url: string, replace?: boolean) {
    if (typeof window == "undefined") return Promise.resolve(this.locate(url));

    return super.next(url, replace);
  }

}
