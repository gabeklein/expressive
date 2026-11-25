import type { Route } from "./route";

type Verdict = string | void | null;

type EntryHook = (route: Route) => Verdict | Promise<Verdict>;

type Call = (path: string, name: string, args: unknown[]) => Promise<unknown>;

interface Hot {
  on(event: string, listener: () => void): void;
}

export const LOOPED = new WeakSet<object>();

const segments = (path: string) => path.split("/").filter(Boolean);

const covers = (outer: string[], inner: string[]) => outer.length <= inner.length && outer.every((part, i) => part === inner[i]);

const never = new Promise<never>(() => {});

/**
 * Entry plumbing, not app API: the generated route tree's gate check, given its gated folders' patterns.
 *
 * Returns a wrapper for a gated folder's entry hook. Entering sends one check to the deepest gated folder on the path
 * unless the last pass covers it; a refusal throws to `Catch`, a 3xx with a `location` redirects.
 */
export function gateCheck(call: Call, patterns: string[], hot?: Hot): (hook?: EntryHook, load?: () => unknown) => EntryHook {
  const gated = patterns.map(segments);
  let passed: string[] | undefined;
  const idle = { path: "", done: Promise.resolve() as Promise<unknown> };
  let pending = idle;

  hot?.on("expressive:gates", () => (passed = undefined));

  const deepest = (pathname: string) => {
    const at = segments(pathname);
    let found: string[] | undefined;

    for (const pattern of gated) {
      const rest = pattern.at(-1) === "*";
      const fixed = rest ? pattern.slice(0, -1) : pattern;
      const fits = fixed.length <= at.length && fixed.every((part, i) => part.startsWith(":") || part.toLowerCase() === at[i].toLowerCase());

      if (fits && (!found || fixed.length >= found.length)) found = rest ? at : at.slice(0, fixed.length);
    }

    return found;
  };

  const check = (at: string[]) => {
    const path = "/" + at.join("/");

    if (pending.path !== path) {
      const entry = { path, done: call(path, "", []).finally(() => pending === entry && (pending = idle)) };
      pending = entry;
    }

    return pending.done;
  };

  return (hook, load) => route => {
    if (typeof window == "undefined") return hook?.(route);

    const { router } = route;
    const at = deepest(router.path);
    const current = () => deepest(router.path)?.join("/") === at!.join("/");

    if (!at || (passed && covers(at, passed))) return hook?.(route);

    void Promise.resolve(load?.()).catch(() => {});

    return check(at).then(
      () => {
        if (!current()) return;

        passed = at;
        return hook?.(route);
      },
      error => {
        if (!current()) return;

        const { status, location: to } = Object(error) as { status?: unknown; location?: unknown };

        if (typeof status != "number" || status < 300 || status >= 400 || typeof to != "string" || !to) throw error;

        const url = new URL(to, window.location.href);

        if (url.origin !== window.location.origin) {
          window.location.assign(url.href);
          return never;
        }

        if (covers(at, segments(url.pathname))) {
          LOOPED.add(error);
          throw error;
        }

        return url.pathname + url.search + url.hash;
      },
    );
  };
}
