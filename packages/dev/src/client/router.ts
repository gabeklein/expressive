import { BrowserRouter } from "@expressive/router";

let path: string | undefined;

/**
 * Entry plumbing, not app API: the path an entering route's hook runs for, read by the call module.
 *
 * Set only during the hook's synchronous run, and only where there is a `window` - else `undefined`.
 */
export const entered = () => path;

/** Run an entering route's entry hook with the path it enters left for the call module, for the hook's synchronous run. */
export function entering<T>(next: string, run: () => T): T {
  if (typeof window == "undefined") return run();

  const before = path;

  path = next;

  try {
    return run();
  } finally {
    path = before;
  }
}

/** The app's `BrowserRouter` - `Router.get().navigating` is true while a navigation holds the current page. */
export class Router extends BrowserRouter {
  protected next(url: string, replace?: boolean) {
    if (typeof window == "undefined") return Promise.resolve(this.locate(url));

    return super.next(url, replace);
  }

}
