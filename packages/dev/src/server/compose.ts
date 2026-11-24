import { matchPattern } from "@expressive/router";
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

/** A build's pages, for the shell fallback: its page routes' patterns, and `build.assetsDir`, never answered with the shell. Dev and tests leave it out. */
export interface Pages {
  patterns: string[];
  assetsDir?: string;
}

type Assets = NonNullable<AppOptions["assets"]>;

const noop = () => {};

/** The app from an entry's settings and the remotes a host composes it with. */
export function compose(settings: Settings = {}, { sidecars = () => [], gates, pages, dev = false }: Parts = {}): App {
  const { handle } = check(settings);

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

/** The shell's status for `request`: 200 on a page route, 404 for a navigation no route matches, else none. GET and HEAD outside `assetsDir` only. */
function shellStatus(request: Request, { patterns, assetsDir = "assets" }: Pages): 200 | 404 | undefined {
  const { method, headers, url } = request;
  const { pathname } = new URL(url);

  if ((method !== "GET" && method !== "HEAD") || pathname.startsWith(`/${assetsDir}/`)) return;
  if (patterns.some(pattern => matchPattern(pattern, pathname))) return 200;
  if (headers.get("accept")?.includes("text/html")) return 404;
}

async function page(request: Request, assets: Assets, pages: Pages): Promise<Response> {
  const reply = await assets.fetch(request);
  const status = reply.status === 404 && shellStatus(request, pages);

  if (!status) return reply;

  const headers = new Headers(request.headers);

  for (const name of CONDITIONAL) headers.delete(name);

  for (const path of SHELLS) {
    const shell = await follow(assets, new Request(new URL(path, request.url), { method: request.method, headers }));

    if (shell.ok) {
      discard(reply);
      return new Response(shell.body, { status, headers: shell.headers });
    }

    discard(shell);
  }

  return reply;
}

async function follow(assets: Assets, request: Request): Promise<Response> {
  const reply = await assets.fetch(request);
  const location = reply.status >= 300 && reply.status < 400 && reply.headers.get("location");
  const to = location ? new URL(location, request.url) : undefined;

  if (!to || to.origin !== new URL(request.url).origin) return reply;

  discard(reply);

  return assets.fetch(new Request(to, request));
}

const mutable =(reply: Response) => (reply.status === 101 ? reply : new Response(reply.body, reply));

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
