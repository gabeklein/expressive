import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

import { isCall, scoped, send, toRequest } from "@expressive/rpc/http";
import { dispatch, failure, verify, type Endpoint } from "@expressive/rpc/protocol";

import { wrap, type AppConfig, type Ctx } from "./config";
import { install } from "./install";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

/** A file under `dir` as a response, typed by extension - opened on first read. */
export function fileResponse(dir: string, pathname: string): Response | undefined {
  const root = resolve(dir);
  let file: string;

  try {
    file = join(root, normalize(decodeURIComponent(pathname)));
  } catch {
    return;
  }

  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return;

  let chunks: AsyncIterator<Uint8Array> | undefined;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await (chunks ??= createReadStream(file)[Symbol.asyncIterator]()).next();

      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await chunks?.return!();
    },
  }, { highWaterMark: 0 });

  return new Response(body, { headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" } });
}

export interface ServeOptions {
  config: AppConfig;
  client: string;
  sidecars?: Endpoint[];
  gates?: { pattern: string[]; gate: () => unknown }[];
}

/**
 * Production server for a built app - the generated server entry calls it, booted by `dist/server/index.js`.
 *
 * Answers calls, then the app's own `fetch`, then serves `client` - a file, a page's `<path>/index.html`, else the `200.html` or `index.html` shell, else 404 - and caches `/assets/` immutably.
 * That last step is what `fetch`'s `next` resolves.
 * Listens only after every sidecar's error classes verify.
 */
export function serve({ config, client, sidecars = [], gates = [] }: ServeOptions): Server {
  install();

  const gateOf = new Map(gates.map(({ pattern, gate }) => [pattern.join("/"), gate]));
  const app = scoped(config);
  const ctx: Ctx = {
    waitUntil: promise => void promise.catch(error => console.error("waitUntil:", error)),
  };
  const gateAt = async (pattern: string[]) => gateOf.get(pattern.join("/"));

  const server = createServer((req, res) => void handle(req, res).catch(() => {
    res.statusCode = 400;
    res.end();
  }));

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const request = toRequest(req, res);

    const scope = { request, env: {}, ctx };

    if (isCall(request)) return send(res, await wrap(config, scope, () => dispatch(request, () => sidecars, false, gateAt)).catch(error => failure(error, sidecars, false)));

    const { pathname } = new URL(request.url);
    const next = async () => {
      const asset = fileResponse(client, pathname);
      if (asset && pathname.startsWith("/assets/")) asset.headers.set("cache-control", "public, max-age=31536000, immutable");

      const found = asset ?? fileResponse(client, join(pathname, "index.html")) ?? fileResponse(client, "/200.html") ?? fileResponse(client, "/index.html");

      return found ?? new Response("Not found", { status: 404 });
    };

    const response = app.fetch && (await wrap(config, scope, async () => app.fetch!(request, scope.env, ctx, next)));

    return send(res, response ?? (await next()));
  }

  const port = config.port ?? 3000;
  const announce = () => console.log(`Expressive running at http://localhost:${port}/`);
  const checked = sidecars.map(async ({ pattern, exports }) => {
    const path = `/${pattern.join("/")}`;
    verify(path, await exports());
  });

  Promise.all(checked).then(() => server.listen(port, announce));

  return server;
}
