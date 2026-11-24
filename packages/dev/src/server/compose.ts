import { HttpError, Redirect, type Env, type ExecutionCtx } from "@expressive/rpc";
import { isCall } from "@expressive/rpc/http";
import { bind, dispatch, failure, type Endpoint, type Seats } from "@expressive/rpc/protocol";

import type { App, HandleArgs, Settings } from "../settings";
import { check } from "./check";

export interface Parts {
  sidecars?: () => Endpoint[];
  gates?: Seats;
  dev?: boolean;
}

const noop = () => {};

/** The app from an entry's settings and the remotes a host composes it with. */
export function compose(settings: Settings = {}, { sidecars = () => [], gates, dev = false }: Parts = {}): App {
  const { env: _, ...read } = settings;
  const { handle } = check(read);

  return async (request, { env = {}, ctx, assets } = {}) => {
    const filled = fill(ctx);

    const below = async (forward: Request): Promise<Response> => {
      bind(forward, env as Env, filled);

      if (isCall(forward)) return dispatch(forward, sidecars, dev, gates).then(mutable).catch(error => failure(error, sidecars(), dev));
      if (!assets) return new Response("Not found.", { status: 404 });

      try {
        return mutable(await assets.fetch(forward));
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
