import { HttpError, Redirect, type Env, type ExecutionCtx } from "@expressive/rpc";
import { isCall } from "@expressive/rpc/http";
import { bind, dispatch, failure, type Endpoint, type Seats } from "@expressive/rpc/protocol";

import type { App, AppOptions, HandleArgs, Settings } from "../settings";
import { check } from "./check";

export interface Parts {
  sidecars?: () => Endpoint[];
  gates?: Seats;
  pages?: Pages;
  dev?: boolean;
}

/**
 * A build's page routes, for the shell fallback.
 *
 * With it, other methods than GET and HEAD skip `assets` for a bare 404.
 * Without `patterns` (a single-file app), every navigation is a page.
 * Dev and the public `compose` leave it out.
 */
export interface Pages {
  patterns?: string[];
  /** `build.assetsDir`, never answered with the shell. Default `"assets"`. */
  assetsDir?: string;
}

type Assets = NonNullable<AppOptions["assets"]>;

const noop = () => {};

/** The app from an entry's settings and the remotes a host composes it with. */
export function compose(settings: Settings = {}, { sidecars = () => [], gates, pages, dev = false }: Parts = {}): App {
  const { env: _, ...read } = settings;
  const { handle } = check(read);

  return async (request, { env = {}, ctx, assets } = {}) => {
    const filled = fill(ctx);

    const below = async (forward: Request): Promise<Response> => {
      bind(forward, env as Env, filled);

      if (isCall(forward)) return dispatch(forward, sidecars, dev, gates).then(mutable).catch(error => failure(error, sidecars(), dev));
      if (!assets) return new Response("Not found.", { status: 404 });

      try {
        return mutable(await (pages ? page(forward, assets, pages) : assets.fetch(forward)));
      } catch (error) {
        return refuse(error, dev);
      }
    };

    if (!handle) return below(request);

    try {
      return await around(handle, { request, env: env as Env, ctx: filled }, below);
    } catch (error) {
      if (!isCall(request)) return refuse(error, dev);
      if (!(error instanceof HttpError)) console.error(error);

      return failure(error, sidecars(), dev);
    }
  };
}

async function around(handle: NonNullable<Settings["handle"]>, args: Omit<HandleArgs, "next">, below: (request: Request) => Promise<Response>): Promise<Response> {
  let taken: Promise<Response> | undefined;
  let returned = false;

  const take = (request: Request) => (taken = below(request));

  const next = (request?: Request) => {
    if (returned) throw new Error("next() was called after handle returned - await it inside handle.");
    if (taken) throw new Error("next() runs once per request.");
    if (request !== undefined && !(request instanceof Request))
      throw new TypeError(`next() forwards a Request, not ${kind(request)} - to wrap it, pass a function that calls it: () => next().`);

    return take(request ?? args.request);
  };

  try {
    const result = await handle({ ...args, next });

    returned = true;

    if (result === undefined) return await (taken ?? take(args.request));
    if (!(result instanceof Response)) throw new TypeError(`handle returned ${kind(result)} - return a Response, or nothing to pass.`);

    void taken?.then(reply => discard(reply, result), noop);

    return result;
  } catch (error) {
    returned = true;
    void taken?.then(reply => discard(reply), noop);
    throw error;
  }
}

const SHELLS = ["/200.html", "/index.html"];
const CONDITIONAL = ["if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "if-range", "range"];

/** Whether a page pattern matches `pathname` as the router does: literals case-insensitively, `:param` one segment, a trailing `*` the rest. */
export function routed(patterns: string[], pathname: string): boolean {
  const path = segments(pathname);

  return patterns.some(pattern => {
    const parts = segments(pattern);
    const rest = parts.at(-1) === "*" && parts.pop();

    return (rest ? path.length >= parts.length : path.length === parts.length)
      && parts.every((part, i) => part.startsWith(":") || part.toLowerCase() === path[i].toLowerCase());
  });
}

function segments(path: string) {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? [] : trimmed.split("/");
}

async function page(request: Request, assets: Assets, { patterns, assetsDir = "assets" }: Pages): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Not found.", { status: 404 });

  const reply = await assets.fetch(request);
  const { pathname } = new URL(request.url);

  if (reply.status !== 404 || pathname.startsWith(`/${assetsDir}/`)) return reply;
  if (patterns && routed(patterns, pathname)) return (await shell(request, assets, 200, reply)) ?? reply;

  const navigation = request.headers.get("accept")?.includes("text/html");
  const answer = (navigation && (await shell(request, assets, patterns ? 404 : 200, reply))) || new Response(reply.body, reply);

  answer.headers.append("vary", "accept");

  return answer;
}

async function shell(request: Request, assets: Assets, status: number, reply: Response): Promise<Response | undefined> {
  const headers = new Headers(request.headers);

  for (const name of CONDITIONAL) headers.delete(name);

  for (const path of SHELLS) {
    const found = await follow(assets, new Request(new URL(path, request.url), { method: request.method, headers }));

    if (found.ok) {
      discard(reply);
      return new Response(found.body, { status, headers: found.headers });
    }

    discard(found);
  }
}

async function follow(assets: Assets, request: Request): Promise<Response> {
  const reply = await assets.fetch(request);
  const location = reply.status >= 300 && reply.status < 400 && reply.headers.get("location");
  const to = location ? new URL(location, request.url) : undefined;

  if (!to || to.origin !== new URL(request.url).origin) return reply;

  discard(reply);

  return assets.fetch(new Request(to, request));
}

const mutable = (reply: Response) => (reply.status === 101 ? reply : new Response(reply.body, reply));

function discard(reply: Response, kept?: Response) {
  if (reply === kept) return;

  const { body, bodyUsed } = reply;

  if (body && body !== kept?.body && !bodyUsed && !body.locked) body.cancel().catch(noop);
}

const kind = (value: unknown) => (value === null ? "null" : typeof value == "object" ? "an object" : typeof value);

function fill(ctx: Partial<ExecutionCtx> = {}): ExecutionCtx {
  const { waitUntil, passThroughOnException, props = {} } = ctx;

  return {
    waitUntil: waitUntil ? promise => waitUntil.call(ctx, promise) : promise => void promise.catch(error => console.error("waitUntil:", error)),
    passThroughOnException: passThroughOnException ? () => passThroughOnException.call(ctx) : noop,
    props,
  };
}

/** A throw outside a call as a reply - an `HttpError`'s status as JSON `{ message }`, else a logged 500. */
export function refuse(error: unknown, dev: boolean): Response {
  if (error instanceof Redirect) return Response.json({ message: error.message }, { status: error.status, headers: { location: error.location } });
  if (error instanceof HttpError && error.status >= 400 && error.status < 600) return Response.json({ message: error.message }, { status: error.status });

  console.error(error);

  return Response.json({ message: dev && error instanceof Error ? error.message : "Internal error." }, { status: 500 });
}
