import { attempt, fault, inFolder, locate, type Call, type Endpoint, type Exports, type Match, type Outcome, type Seats } from "../call";
import { parse, stringify } from "../codec";
import { headersOf, within } from "../context";
import { ERRORS } from "../errors";
import { reserved, walk, type Tree } from "../route";

export function isCall(request: Request): boolean {
  const { headers } = request;
  const named = headers.has("x-expressive-call") || headers.has("x-expressive-get");

  return request.method === "POST" && named && !!headers.get("content-type")?.startsWith("application/json");
}

export interface Incoming<E extends Exports = Exports> {
  request: Request;
  list: Endpoint<E>[];
  at: string[];
  pathname: string;
  found?: Match<E>;
  exports?: E;
  dev: boolean;
  seats: Seats;
}

export type Handle = (args: unknown[]) => Promise<Response>;

export type Tier<E extends Exports> = (incoming: Incoming<E>, fn?: Call) => Promise<Handle | undefined>;

export interface HandlerOptions {
  dev?: boolean;
  seats?: Seats;
  /** Path the calls are served under, such as `/api` - a request outside it is not a call. */
  base?: string;
  /** Error classes a call may throw, by id - one thrown keeps its class and fields on the client. */
  errors?: Record<string, unknown>;
}

/**
 * Answer the calls in `tree` - give any other request `undefined`.
 *
 * A call's address is its place in the tree: `api.admin.users.ban` answers `POST /admin/users`
 * named `ban`. An error thrown that `errors` does not list replies 500 - its message in `dev`, a
 * generic one otherwise. Throws if any name in the tree is `with` or `then`.
 *
 * @example
 * export default { fetch: handler(api, { base: "/api", errors: { Duplicate } }) };
 */
export function handler(tree: Tree, options?: HandlerOptions): (request: Request) => Promise<Response | undefined>;

export function handler(endpoints: Endpoint[] | (() => Endpoint[]), options?: HandlerOptions): (request: Request) => Promise<Response | undefined>;

export function handler(endpoints: Tree | Endpoint[] | (() => Endpoint[]), { dev = false, seats, base = "", errors }: HandlerOptions = {}): (request: Request) => Promise<Response | undefined> {
  const prefix = base.split("/").filter(Boolean);
  const under = (request: Request) => {
    const at = new URL(request.url).pathname.split("/").filter(Boolean);
    return prefix.every((part, i) => at[i] === part);
  };

  if (Array.isArray(endpoints) || typeof endpoints == "function") {
    const list = typeof endpoints == "function" ? endpoints : () => endpoints;
    return async request => (isCall(request) && under(request) ? dispatch(request, list, dev, seats, undefined, prefix.length) : undefined);
  }

  const table = { ...ERRORS, ...errors };

  reserved(endpoints);

  return async request => (isCall(request) && under(request) ? answer(request, endpoints, dev, table, prefix.length) : undefined);
}

async function answer(request: Request, tree: Tree, dev: boolean, errors: Record<string, unknown>, skip: number): Promise<Response> {
  const at = new URL(request.url).pathname.split("/").filter(Boolean).slice(skip);
  const name = request.headers.get("x-expressive-call");
  const found = name !== null && walk(tree, at, name);

  if (!found) return reply(404, { message: "Not found." });

  const args = await readArgs(request);

  if (!args) return reply(400, { message: "Expected a JSON array of arguments." });

  const outcome = await attempt(() => within(request, at, () => found.fn(...args), found.seats), [], dev, errors);

  return withHeaders(respond(outcome), headersOf(request));
}

const unseated: Seats = async () => undefined;

export async function dispatch<E extends Exports>(request: Request, endpoints: () => Endpoint<E>[], dev: boolean, seats = unseated, tier?: Tier<E>, skip = 0): Promise<Response> {
  const list = endpoints();
  const { pathname } = new URL(request.url);
  const at = pathname.split("/").filter(Boolean).slice(skip);
  const name = request.headers.has("x-expressive-get") ? undefined : request.headers.get("x-expressive-call") ?? undefined;
  const { found, exports, fn } = await locate(list, at, name);
  const incoming = { request, list, at, pathname, found, exports, dev, seats };
  const handle = tier ? await tier(incoming, fn) : fn && plain(incoming, fn);

  if (!handle) return reply(404, { message: "Not found." });

  const args = await readArgs(request);

  if (!args) return reply(400, { message: "Expected a JSON array of arguments." });

  return withHeaders(await handle(args), headersOf(request));
}

type Fetch = (request: Request, ...rest: any[]) => Response | undefined | Promise<Response | undefined>;

/**
 * An app's server entry with its `fetch` run in the request's scope: `Current` and `Cookies` work in
 * its routes as in a call, and the headers and cookies they set join the route's response.
 */
export function scoped<A extends { fetch?: Fetch }>(app: A): A {
  const fetch = app?.fetch;

  if (typeof fetch != "function") return app;

  const run: Fetch = async (request, ...rest) => {
    const response = await within(request, [], () => fetch.call(app, request, ...rest));
    return response && withHeaders(response, headersOf(request));
  };

  return Object.assign(Object.create(Object.getPrototypeOf(app)), app, { fetch: run });
}

/** Add what the call set to its reply - the reply's own headers win, and a cookie it already sets is not repeated. */
function withHeaders(response: Response, extra?: Headers): Response {
  if (!extra) return response;

  const headers = new Headers(response.headers);
  const sent = new Set(response.headers.getSetCookie());

  extra.forEach((value, name) => name === "set-cookie" || response.headers.has(name) || headers.set(name, value));

  for (const cookie of extra.getSetCookie()) if (!sent.has(cookie)) headers.append("set-cookie", cookie);

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function plain(incoming: Incoming, fn: Call): Handle {
  return async args => respond(await attempt(() => inFolder(incoming, () => fn(...args)), incoming.list, incoming.dev, ERRORS));
}

async function readArgs(request: Request): Promise<unknown[] | undefined> {
  try {
    const args = parse(await request.text());
    return Array.isArray(args) ? args : undefined;
  } catch {
    return undefined;
  }
}

export async function failure(error: unknown, endpoints: Endpoint[], dev: boolean, headers?: Record<string, string>): Promise<Response> {
  return respond(await fault(error, endpoints, dev, ERRORS), headers);
}

function respond(outcome: Outcome, headers?: Record<string, string>): Response {
  if ("value" in outcome) return reply(200, { value: outcome.value }, headers);

  return reply(statusOf(outcome.status), outcome.error, headers);
}

function statusOf(status?: number): number {
  return status !== undefined && status >= 400 && status < 600 ? status : 500;
}

export function reply(status: number, value?: unknown, headers: Record<string, string> = {}): Response {
  if (value === undefined) return new Response(null, { status, headers });

  return new Response(stringify(value), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}
