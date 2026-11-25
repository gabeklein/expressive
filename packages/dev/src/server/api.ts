import { BadRequest, NotFound } from "@expressive/rpc";
import { layer, within } from "@expressive/rpc/protocol";

export type Exports = Record<string, unknown>;

/** One module under `api/`: its path from the folder (`photo`, `:id`, `*`), and whether it is a folder's `index`. */
export interface ApiRoute {
  name: string;
  path: string[];
  index: boolean;
  load(): Exports | Promise<Exports>;
}

/** The `api/` folder's routes, served under `prefix`. */
export interface Api {
  prefix: string;
  routes(): ApiRoute[] | Promise<ApiRoute[]>;
}

interface Node {
  route?: ApiRoute;
  fixed: Map<string, Node>;
  param?: { name: string; node: Node };
  splat?: ApiRoute;
}

type Gate = { route: ApiRoute; params: Record<string, string> };

export const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const trees = new WeakMap<ApiRoute[], Node>();

/** Whether `pathname` belongs to the folder: `prefix` itself or below it. */
export const owns = ({ prefix }: Api, pathname: string) => pathname === prefix || pathname.startsWith(prefix + "/");

function treeOf(routes: ApiRoute[]): Node {
  let root = trees.get(routes);

  if (root) return root;

  trees.set(routes, (root = { fixed: new Map() }));

  for (const route of routes) {
    let node = root;
    const path = [...route.path];
    const splat = path.at(-1) === "*" && path.pop();

    for (const segment of path)
      if (segment.startsWith(":")) node = (node.param ??= { name: segment.slice(1), node: { fixed: new Map() } }).node;
      else node = node.fixed.get(segment) ?? (node.fixed.set(segment, { fixed: new Map() }).get(segment)!);

    if (splat) node.splat = route;
    else node.route = route;
  }

  return root;
}

function match(root: Node, segments: string[]) {
  const params: Record<string, string> = {};
  const gates: Gate[] = [];
  const gate = ({ route }: Node) => route?.index && gates.push({ route, params: { ...params } });
  let node = root;

  gate(node);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (segment === "") return { gates };

    const fixed = node.fixed.get(segment);

    if (fixed) node = fixed;
    else if (node.param) {
      params[node.param.name] = segment;
      node = node.param.node;
    } else if (node.splat) {
      params["*"] = segments.slice(i).join("/");
      return { gates, route: node.splat, params };
    } else return { gates };

    gate(node);
  }

  return { gates, route: node.route, params };
}

/** Answer a request under the folder: its gates outermost first, then the matching module's verb or catch-all. */
export async function serveApi(request: Request, api: Api, dev: boolean): Promise<Response> {
  const { pathname } = new URL(request.url);
  const { method } = request;
  let segments: string[];

  try {
    segments = (pathname === api.prefix ? [] : pathname.slice(api.prefix.length + 1).split("/")).map(decodeURIComponent);
  } catch {
    throw new BadRequest(`${pathname} has a malformed escape.`);
  }

  const { gates, route, params } = match(treeOf(await api.routes()), segments);
  const loaded = await Promise.all(gates.map(async gate => ({ ...gate, run: (await gate.route.load()).default as (() => unknown) | undefined })));
  const active = loaded.filter(gate => gate.run);
  const exports = route && (await route.load());
  const verbs = exports ? VERBS.filter(verb => verb in exports) : [];
  const handler = exports && ((VERBS.includes(method) && exports[method]) || (method === "HEAD" && exports.GET) || (!route!.index && exports.default));

  const last = async (): Promise<Response> => {
    if (handler) return layer(handler as () => unknown, undefined, params, dev);
    if (!verbs.length) throw new NotFound(`No route in api/ serves ${pathname} - paths under ${api.prefix} belong to api/.`);

    const allow = verbs.flatMap(verb => (verb === "GET" ? [verb, "HEAD"] : [verb])).join(", ");
    const reply = Response.json({ message: `${pathname} does not answer ${method}.` }, { status: 405 });

    reply.headers.set("allow", allow);
    return reply;
  };

  const chain = (at: number): Promise<Response> =>
    at < active.length ? layer(active[at].run!, () => chain(at + 1), active[at].params, dev) : last();

  return within(request, [], () => chain(0));
}
