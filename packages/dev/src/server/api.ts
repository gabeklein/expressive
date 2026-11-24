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

/** What is wrong with a module's exports - `names` its runtime exports, `classDefault` whether its `default` is a class. */
export function problems(names: Iterable<string>, index: boolean, root: boolean, classDefault: boolean): string[] {
  const found: string[] = [];
  const all = [...names];
  const verbs = all.filter(name => VERBS.includes(name));
  const gate = all.includes("default");

  for (const name of all)
    if (name !== "default" && !VERBS.includes(name))
      found.push(root && index
        ? `\`${name}\` - api/index.ts's other exports are reserved; export only verbs and a default gate.`
        : `\`${name}\` is not a route export - export ${VERBS.join(", ")} or a default, and keep helpers outside api/.`);

  if (index && classDefault) found.push("A folder's default is its gate - a function, not a class: export default () => { Session.new() }");
  if (!index && gate && verbs.length) found.push("A default answers every method - export it or verbs, not both.");
  if (!gate && !verbs.length) found.push(`No handler - export ${VERBS.join(", ")} or a default.`);

  return found;
}

/** Throw if a loaded module breaks the route rules, naming its file. */
export function verifyApi({ name, index, path }: ApiRoute, exports: Exports): void {
  const found = problems(Object.keys(exports), index, !path.length, isClass(exports.default));

  for (const key of [...VERBS, "default"]) if (key in exports && typeof exports[key] != "function") found.push(`\`${key}\` is not a function.`);

  if (found.length) throw new Error(`${name}: ${found.join(" ")}`);
}

const isClass = (value: unknown) => typeof value == "function" && /^class\b/.test(Function.prototype.toString.call(value));

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

function match(root: Node, raw: string[], decoded: string[]) {
  const params: Record<string, string> = {};
  const gates: Gate[] = [];
  const gate = ({ route }: Node) => route?.index && gates.push({ route, params: { ...params } });
  let node = root;

  gate(node);

  for (let i = 0; i < raw.length; i++) {
    const fixed = raw[i] !== "" && node.fixed.get(raw[i]);

    if (fixed) node = fixed;
    else if (raw[i] !== "" && node.param) {
      params[node.param.name] = decoded[i];
      node = node.param.node;
    } else if (raw[i] !== "" && node.splat) {
      params["*"] = decoded.slice(i).join("/");
      return { gates, route: node.splat, params };
    } else return { gates };

    gate(node);
  }

  return { gates, route: node.route, params };
}

/** Answer a request under the folder: its gates outermost first, then the matching module's verb or catch-all. */
export async function serveApi(request: Request, api: Api): Promise<Response> {
  const { pathname } = new URL(request.url);
  const raw = pathname === api.prefix ? [] : pathname.slice(api.prefix.length + 1).split("/");
  let decoded: string[];

  try {
    decoded = raw.map(decodeURIComponent);
  } catch {
    throw new BadRequest(`${pathname} has a malformed escape.`);
  }

  const { gates, route, params } = match(treeOf(await api.routes()), raw, decoded);
  const load = async (route: ApiRoute) => {
    const exports = await route.load();
    verifyApi(route, exports);
    return exports;
  };

  const loaded = await Promise.all(gates.map(async gate => ({ ...gate, run: (await load(gate.route)).default as (() => unknown) | undefined })));
  const active = loaded.filter(gate => gate.run);
  const exports = route && (await load(route));
  const verbs = exports ? VERBS.filter(verb => verb in exports) : [];
  const handler = exports && (exports[request.method] || (request.method === "HEAD" && exports.GET) || (!route!.index && exports.default));

  const last = async (): Promise<Response> => {
    if (handler) return layer(handler as () => unknown, undefined, params);
    if (!verbs.length) throw new NotFound(`No route in api/ serves ${pathname} - paths under ${api.prefix} belong to api/.`);

    const allow = verbs.flatMap(verb => (verb === "GET" ? [verb, "HEAD"] : [verb])).join(", ");
    const reply = Response.json({ message: `${pathname} does not answer ${request.method}.` }, { status: 405 });

    reply.headers.set("allow", allow);
    return reply;
  };

  const chain = (at: number): Promise<Response> =>
    at < active.length ? layer(active[at].run!, () => chain(at + 1), active[at].params) : last();

  const reply = await within(request, [], () => chain(0));

  if (request.method !== "HEAD" || !reply.body) return reply;

  reply.body.cancel().catch(console.error);
  return new Response(null, reply);
}
