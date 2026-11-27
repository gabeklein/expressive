import { attempt, fault, inFolder, locate, type Endpoint, type Outcome, type Seats } from "../call";
import { CODEC, parse, stringify } from "../codec";
import { bodyOf } from "../body";
import { ensureInstalled, pass, within } from "../context";
import { ERRORS } from "../errors";
import { reserved, walk, type Tree } from "../route";

export function isCall(request: Request): boolean {
  const { headers } = request;

  return request.method === "POST" && headers.has("x-expressive-call") && !!headers.get("content-type")?.startsWith("application/json");
}

export interface HandlerOptions {
  /** Path the calls are served under, such as `/api` - a request outside it is not a call. */
  base?: string;
  /** Error classes a call may throw, by id - one thrown keeps its class and fields on the client. */
  errors?: Record<string, unknown>;
}

/**
 * Answer the calls in `tree` - give any other request `undefined`.
 *
 * A call's address is its place in the tree: `api.admin.users.ban` answers `POST /admin/users`
 * named `ban`. An error thrown that `errors` does not list replies 500 with a generic message -
 * its own under the plugin's dev server. Throws if any name in the tree is `with` or `then`.
 *
 * @example
 * export default { fetch: handler(api, { base: "/api", errors: { Duplicate } }) };
 */
export function handler(tree: Tree, options?: HandlerOptions): (request: Request) => Promise<Response | undefined>;

export function handler(tree: Tree, { dev = false, base = "", errors }: HandlerOptions & { dev?: boolean } = {}): (request: Request) => Promise<Response | undefined> {
  const prefix = base.split("/").filter(Boolean);
  const under = (request: Request) => {
    const at = new URL(request.url).pathname.split("/").filter(Boolean);
    return prefix.every((part, i) => at[i] === part);
  };
  const table = { ...ERRORS, ...errors };

  reserved(tree);
  ensureInstalled();

  return async request => (isCall(request) && under(request) ? answer(request, tree, dev, table, prefix.length) : undefined);
}

async function answer(request: Request, tree: Tree, dev: boolean, errors: Record<string, unknown>, skip: number): Promise<Response> {
  const at = new URL(request.url).pathname.split("/").filter(Boolean).slice(skip);
  const name = request.headers.get("x-expressive-call");
  const found = name !== null && walk(tree, at, name);

  if (!found) return reply(404, { message: "Not found." });

  const args = await readArgs(request);

  if (!args) return reply(400, { message: "Expected a JSON array of arguments." });

  return within(request, at, async () => respond(await attempt(() => found.fn(...args), [], dev, errors)), found.seats, async error => respond(await fault(error, [], dev, errors)));
}

const unseated: Seats = async () => undefined;

export async function dispatch(request: Request, endpoints: () => Endpoint[], dev: boolean, seats = unseated, skip = 0): Promise<Response> {
  const list = endpoints();
  const at = new URL(request.url).pathname.split("/").filter(Boolean).slice(skip);
  const name = request.headers.get("x-expressive-call");
  const { found, fn } = await locate(list, at, name);

  if (!fn) return reply(404, { message: "Not found." });

  const args = await readArgs(request);

  if (!args) return reply(400, { message: "Expected a JSON array of arguments." });

  const fail = async (error: unknown) => respond(await fault(error, list, dev, ERRORS));

  return inFolder({ request, found, seats }, async () => respond(await attempt(() => fn(...args), list, dev, ERRORS)), fail).catch(fail);
}

type Fetch = (request: Request, ...rest: any[]) => Response | undefined | Promise<Response | undefined>;

/**
 * An app's server entry with its `fetch` run as one layer of the request's scope: `Current` and
 * `Cookies` work in its routes as in a call, `send`, `json` and `text` too, and the headers and cookies
 * they set join the route's response. `next` throws, and returning nothing passes `undefined` on.
 */
export function scoped<A extends { fetch?: Fetch }>(app: A): A {
  const fetch = app?.fetch;

  if (typeof fetch != "function") return app;

  ensureInstalled();

  const run: Fetch = (request, ...rest) => within(request, [], () => pass(() => fetch.call(app, bodyOf(request), ...rest)));

  return Object.assign(Object.create(Object.getPrototypeOf(app)), app, { fetch: run });
}

async function readArgs(request: Request): Promise<unknown[] | undefined> {
  try {
    const args = parse(await bodyOf(request).text());
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
  if (status !== undefined && status >= 300 && status < 400) return 400;

  return status !== undefined && status >= 400 && status < 600 ? status : 500;
}

function reply(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(stringify(value), { status, headers: { ...headers, "content-type": CODEC } });
}
