import type { Route } from "./route";
import { entering } from "./router";

type Verdict = string | void | null;

type EntryHook = (route: Route) => Verdict | Promise<Verdict>;

type Call = (path: string, name: string, args: unknown[]) => Promise<unknown>;

interface Hot {
  on(event: string, listener: () => void): void;
}

/** A route in the generated tree: its segment, whether its folder is gated, has a page or a `NotFound`, and the routes inside a folder. */
export interface GateNode {
  to?: string;
  gate?: 1;
  page?: 1;
  none?: 1;
  in?: GateNode[];
}

interface Found {
  gate?: string[];
}

const segments = (path: string) => path.split("/").filter(Boolean);

const covers = (outer: string[], inner: string[]) => outer.length <= inner.length && outer.every((part, i) => part === inner[i]);

const stay = (error: unknown) => Object.assign(error as object, { location: undefined });

function walk(node: GateNode, at: string[], i: number, path: string[], gate: string[] | undefined, pages: boolean): Found | undefined {
  if (node.gate) gate = path;
  if (i === at.length && node.page) return { gate };

  for (const child of node.in!) {
    const to = child.to!;
    const rest = to === "*";
    const fits = i < at.length && (rest || to.startsWith(":") || to.toLowerCase() === at[i].toLowerCase());

    if (!fits) continue;

    const next = rest ? [...path, ...at.slice(i)] : [...path, to.startsWith(":") ? at[i] : to];
    const found = child.in
      ? walk(child, at, rest ? at.length : i + 1, next, gate, pages)
      : rest || i + 1 === at.length ? { gate } : undefined;

    if (found) return found;
  }

  if (node.none && !pages) return { gate };
}

/**
 * Entry plumbing, not app API: the generated route tree's gate check, given that tree's routes.
 *
 * Returns a wrapper for a gated folder's entry hook. Entering sends one check to the deepest gated folder on the path
 * unless the last pass covers it; a refusal throws to `Catch`, a 3xx with a `location` redirects.
 * Paths under `base`, Vite's `BASE_URL`, match the tree without it and are checked with it; a redirect outside it leaves the app.
 * A `base` not starting with `/` counts as `/`.
 */
export function gateCheck(call: Call, tree: GateNode, hot?: Hot, base = "/"): (hook?: EntryHook, load?: () => unknown) => EntryHook {
  const idle = { path: "", done: Promise.resolve() as Promise<unknown> };
  let pending = idle;
  let passed: string[] | undefined;
  let hopped: string | undefined;

  hot?.on("expressive:gates", () => (passed = undefined));

  const root = segments(base[0] == "/" ? base : "/");
  const within = (pathname: string) => {
    const at = segments(pathname);
    if (covers(root, at)) return at.slice(root.length);
  };

  const deepest = (pathname: string) => walk(tree, within(pathname)!, 0, [], undefined, false)!.gate;

  const check = (path: string) => {
    if (pending.path !== path) {
      const entry = { path, done: call(path, "", []).finally(() => pending === entry && (pending = idle)) };
      pending = entry;
    }

    return pending.done;
  };

  return (hook, load) => route => {
    if (typeof window == "undefined") return hook?.(route);

    const { router } = route;
    const at = deepest(router.path)!;
    const path = "/" + [...root, ...at].join("/");
    const current = () => deepest(router.path)?.join("/") === at.join("/");
    const after = hopped === router.path;

    hopped = undefined;

    if (passed && covers(at, passed)) return hook?.(route);

    void Promise.resolve(load?.()).catch(() => {});

    return check(path).then(
      verdict => {
        if (!current()) return;
        if (verdict === true) passed = at;

        return entering(router.path, () => hook?.(route));
      },
      error => {
        if (!current()) return;

        const { status, location: to } = Object(error) as { status?: unknown; location?: unknown };

        if (typeof status != "number" || status < 300 || status >= 400 || typeof to != "string" || !to) throw error;

        const url = new URL(to, window.location.href);
        const local = url.origin === window.location.origin ? within(url.pathname) : undefined;

        if (after || !/^https?:$/.test(url.protocol) || (local && covers(at, local))) throw stay(error);

        if (!local || !walk(tree, local, 0, [], undefined, true)) {
          window.location.assign(url.href);
          return new Promise<never>(() => {});
        }

        hopped = url.pathname;

        return url.pathname + url.search + url.hash;
      },
    );
  };
}
