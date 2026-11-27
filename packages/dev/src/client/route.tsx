/** @jsxImportSource @expressive/jsx */

import { Component, Context, Model, set, unbind } from "@expressive/mvc";
import { Route as Base, Redirect as RouterRedirect, fullPattern, matchPattern } from "@expressive/router";
import { Redirect } from "@expressive/rpc";
import { childrenOf, propsOf, typeOf } from "@expressive/jsx/jsx-runtime";
import { replaced } from "@expressive/mvc/hot";

import { entering } from "./router";

type CatchUI = (props: { error: Error; retry: () => void }) => Component.Node;

type Verdict = string | void | null;

type EntryHook = (route: Route) => Verdict | Model.Extends | Promise<Verdict | Model.Extends>;

const DEFAULTS = new WeakMap<Route, Model>();
const DISPOSE = new WeakMap<Route, () => void>();
const TOKENS = new WeakMap<Route, object>();
const OWNED = new WeakSet<Model>();
const WRAPPED = new WeakSet<Route>();
const WARNED = new WeakSet<EntryHook>();
const HOT = "expressive:route-update";
const EXTERNAL = /^([a-z][a-z\d+.-]*:|\/\/)/i;

export const owns = (instance: Model) => OWNED.has(instance);

const methodSource = (type: Model.Extends, key: string) => {
  const { get, value } = Object.getOwnPropertyDescriptor(type.prototype, key) ?? {};
  return unbind(get ?? value)?.toString();
};

/**
 * Router's `Route` with a route module's exports - the generated tree builds one per module.
 *
 * Extend it for a class `Page`; the tree sets `enter`, `Catch` and `fallback`.
 */
export class Route extends Base {
  /** Shown while this route or a page below suspends on a cold load - the folder's `Loading`. Default none. */
  fallback: Component.Node = false;

  /**
   * Internal entry step for generated route defaults and gated folders.
   *
   * The gate runs before a default class is built. A thrown error reaches `Catch`.
   */
  enter = set<EntryHook | undefined>(undefined, hook => arm(this, hook));

  /** Error UI for this route - `retry` re-renders the content. */
  Catch?: CatchUI = undefined;
}

const REFUSED = new Set<Route>();
const WATCHED = new WeakSet<Route>();
const REDIRECTING = new WeakSet<object>();

function arm(route: Route, hook: EntryHook | undefined) {
  const refused = (error: unknown, token: object) => {
    if (!route.matched || TOKENS.get(route.is) !== token) return;
    try {
      return redirected(error);
    } catch (error) {
      remember(route);
      throw error;
    }
  };

  const enter = (run: EntryHook) => entering(route.router.path, () => run(route));

  const built = async (value: Verdict | Model.Extends, token: object): Promise<Verdict> => {
    if (TOKENS.get(route.is) !== token || !route.matched) return;
    if (!Model.is(value)) return value as Verdict;
    const { source, leaf } = hook as EntryHook & { source?: string; leaf?: boolean };
    if (leaf && source && hook && !Component.is(value) && !WARNED.has(hook)) {
      WARNED.add(hook);
      console.warn(`${source}: a Model default without Page renders nothing.`);
    }
    const context = new Context(Context.get(route));
    const instance = entering(route.router.path, () => (value as Model.Type<Model>).new(context));
    OWNED.add(instance);
    try {
      await instance.set();
    } catch (error) {
      instance.set(null);
      context.pop();
      throw error;
    }
    if (TOKENS.get(route.is) !== token || !route.matched) {
      instance.set(null);
      context.pop();
      return;
    }
    DISPOSE.get(route.is)?.();
    DEFAULTS.set(route.is, instance);
    const originalNew = methodSource(value, "new");
    let retired = false;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unwatch();
      unready();
      unreplace();
      unregister();
      if (typeof window !== "undefined") window.removeEventListener(HOT, onHot);
      DEFAULTS.delete(route.is);
      DISPOSE.delete(route.is);
      instance.set(null);
      context.pop();
    };
    const onHot = (event: Event) => {
      const source = (route.enter as EntryHook & { source?: string } | undefined)?.source;
      const paths = (event as CustomEvent<string[]>).detail;
      if (!source || !paths?.includes("/" + source)) return;
      if (!retired && !instance.get(null) && methodSource(value, "new") === originalNew) {
        const current = (route.enter as EntryHook & { current?: EntryHook } | undefined)?.current;
        const next = current?.(route);
        if (next instanceof Promise) void next.then(type => { if (Model.is(type) && type !== value) { dispose(); arm(route, route.enter); } }).catch(() => {});
        else if (Model.is(next) && next !== value) { dispose(); arm(route, route.enter); }
        return;
      }
      dispose();
      arm(route, route.enter);
    };
    const leave = () => {
      if (route.matched || route.router.navigating) return;
      dispose();
      return null;
    };
    const unwatch = route.router.set("path", leave);
    const unready = route.router.set("navigating", leave);
    const unreplace = replaced(({ prev }) => {
      if (instance instanceof prev) retired = true;
    });
    if (typeof window !== "undefined") window.addEventListener(HOT, onHot);
    const unregister = route.set(null, dispose);
    DISPOSE.set(route.is, dispose);
  };

  if (hook && !WRAPPED.has(route.is)) {
    const original = route.as;
    WRAPPED.add(route.is);
    route.as = function DefaultContent(props: { children?: Component.Node }) {
      const Original = original;
      const content = Original ? <Original>{props.children}</Original> : props.children;
      const instance = DEFAULTS.get(route.is);
      return instance ? <Component for={instance}>{content}</Component> : content;
    } as typeof route.as;
  }

  route.redirect = hook && (() => {
    const token = {};
    TOKENS.set(route.is, token);
    try {
      const verdict = enter(hook);

      return verdict instanceof Promise
        ? verdict.then(next => built(next, token)).catch(error => refused(error, token))
        : Model.is(verdict) ? built(verdict, token).catch(error => refused(error, token)) : verdict;
    } catch (error) {
      return refused(error, token);
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

  if (typeof status == "number" && status >= 300 && status < 400 && typeof location == "string" && location && !EXTERNAL.test(location)) return location;

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
          window.removeEventListener(HOT, retry);
          REFUSED.forEach(route => arm(route, route.enter));
          REFUSED.clear();
          this.fallback = initial;
          resolve();
        };

        this.fallback = <Boundary error={error} retry={retry} />;
        unwatch = this.router.set("path", () => {
          if (this.router.path !== path) retry();
        });
        window.addEventListener(HOT, retry);
        this.set(null, () => { unwatch(); window.removeEventListener(HOT, retry); });
      });
    };

    return (error: Error) => {
      if (error instanceof RouterRedirect || (error instanceof Redirect && error.location)) {
        const router = this.router.is;
        if (REDIRECTING.has(router)) return caught(error);
        const to = error instanceof RouterRedirect ? error.to : error.location;
        if (typeof window === "undefined")
          return EXTERNAL.test(to) ? Promise.reject(error) : redirect.call(this, error instanceof RouterRedirect ? error : new RouterRedirect(to));
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
