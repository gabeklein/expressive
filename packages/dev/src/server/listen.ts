import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

import { send, toRequest } from "@expressive/rpc/http";

import type { Settings } from "../settings";
import type { ApiRoute, Exports } from "./api";
import { compose, type Pages } from "./compose";
import { layered } from "./env";
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

/** A file under `dir`, else its `<path>/index.html` - as `ASSETS` and the built server resolve them. */
export function staticFile(dir: string, pathname: string): Response | undefined {
  return fileResponse(dir, pathname) ?? fileResponse(dir, join(pathname, "index.html"));
}

export interface ListenOptions {
  settings: Settings;
  client: string;
  /** The `api/` folder's modules, served under `prefix`. */
  api?: { prefix: string; routes: (Omit<ApiRoute, "load"> & { module: Exports })[] };
  pages?: Pages;
}

/**
 * Entry plumbing, not app API: the production server the generated entry starts, booted by `dist/server/index.js`.
 *
 * Composes the app `settings` over `client` - for GET and HEAD, a file, else a page's `<path>/index.html`, else the `200.html` or `index.html` shell by the page rule, else 404 - caching `assetsDir` immutably.
 * Binds `process.env` over the `.env` files as each request's `env`.
 * Listens on `settings.port`, default 3000.
 */
export function listen({ settings, client, api, pages = { patterns: [] } }: ListenOptions): Server {
  install();

  const routes = api?.routes.map(({ module, ...ref }) => ({ ...ref, load: () => module }));
  const app = compose(settings, { api: routes && { prefix: api!.prefix, routes: () => routes }, pages });
  const assets = { fetch: async (request: Request) => files(client, request, `/${pages.assetsDir ?? "assets"}/`) };
  const env = layered();

  const server = createServer((req, res) => void handle(req, res).catch(() => {
    res.statusCode = 400;
    res.end();
  }));

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const request = toRequest(req, res);

    return send(res, await app(request, { env, assets }));
  }

  const port = settings.port ?? 3000;
  server.listen(port, () => console.log(`Expressive running at http://localhost:${port}/`));

  return server;
}

function files(client: string, { url }: Request, immutable: string): Response {
  const { pathname } = new URL(url);
  const found = staticFile(client, pathname);

  if (!found) return new Response("Not found", { status: 404 });
  if (pathname.startsWith(immutable)) found.headers.set("cache-control", "public, max-age=31536000, immutable");

  return found;
}
