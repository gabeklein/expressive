import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import type { ModuleRunner } from "vite/module-runner";
import hot from "@expressive/dom/vite";
import { accept } from "@expressive/mvc/hot";
import { Model } from "@expressive/mvc";
import { construct, retire } from "@expressive/rpc/protocol";

import { rotate } from "../server/connection";

import { expressive } from "./plugin";
import { reloads } from "./reload";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const SOURCES = [
  { find: /^@expressive\/([^/]+)$/, replacement: `${PACKAGES}$1/src` },
  { find: /^@expressive\/([^/]+)\/(.+)$/, replacement: `${PACKAGES}$1/src/$2` },
];

const g = globalThis as any;

beforeAll(async () => {
  g.hostMvc = await import("@expressive/mvc");
  g.hostHot = await import("@expressive/mvc/hot");
});

interface Stats {
  connections: number;
  twins: number;
  watchers: number;
  layers: number;
  seats: number;
  pooled: number;
}

describe("server reload", () => {
  const dirs: string[] = [];
  const servers: ViteDevServer[] = [];
  const aborts: AbortController[] = [];

  afterEach(async () => {
    aborts.splice(0).forEach(abort => abort.abort());
    while (servers.length) await servers.pop()!.close();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    retire();
    rotate(true);
  });

  const shim = (root: string, name: string, from: string) => {
    const file = join(root, `${name}.ts`);
    writeFileSync(file, `export const { ${Object.keys(g[from]).filter(n => n !== "default").join(", ")} } = (globalThis as any).${from};`);
    return file;
  };

  async function serve(files: Record<string, string>, patch = false) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "reload-")));
    dirs.push(root);

    for (const [path, src] of Object.entries({ "app/index.tsx": "export function Page(){ return null }", ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), src);
    }

    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: patch ? [expressive(), hot() as unknown as Plugin] : [expressive()],
      resolve: {
        alias: [
          { find: /^@expressive\/mvc$/, replacement: shim(root, "host-mvc", "hostMvc") },
          { find: /^@expressive\/mvc\/hot$/, replacement: shim(root, "host-hot", "hostHot") },
          ...SOURCES,
        ],
      },
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { watch: null },
    });
    servers.push(server);
    await server.listen(0);

    for (const path of Object.keys(files)) if (path.endsWith("remote.ts")) await server.transformRequest(`/${path}`);

    const url = (path: string) => new URL(path, server.resolvedUrls!.local[0]);

    const edit = (path: string, src: string) => {
      writeFileSync(join(root, path), src);
      server.watcher.emit("change", join(root, path));
    };

    const post = async (tab: string, at: string, headers: Record<string, string>, body = "[]") => {
      const res = await fetch(url(at), {
        method: "POST",
        headers: { "content-type": "application/json", "x-expressive-connection": tab, ...headers },
        body,
      });
      return { epoch: res.headers.get("x-expressive-epoch"), status: res.status, ...(await res.json()) };
    };

    const listen = async (tab: string) => {
      const abort = new AbortController();
      const res = await fetch(url(`/.expressive/stream?connection=${tab}`), { signal: abort.signal });
      const reader = res.body!.getReader();
      const hellos: string[] = [];

      aborts.push(abort);
      (async () => {
        for (let read = await reader.read(); !read.done; read = await reader.read())
          for (const [, epoch] of new TextDecoder().decode(read.value).matchAll(/event: hello\ndata: \{"epoch":"([\w-]+)"\}/g)) hellos.push(epoch);
      })().catch(() => {});

      await until(() => hellos.length > 0);

      return { hellos, close: () => abort.abort() };
    };

    const stats = async (): Promise<Stats> => (await fetch(url("/.expressive/stats"))).json();

    return { edit, post, listen, stats };
  }

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 300 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(check()).toBe(true);
  };

  const tab = () => crypto.randomUUID();

  const SEAT = (version: string, fields = "") => `
    import { Model } from "@expressive/mvc";
import { construct, retire } from "@expressive/rpc/protocol";

import { rotate } from "../server/connection";
    import { label } from "./lib";
    (globalThis as any).loads.push(${JSON.stringify(version)});
    import.meta.hot?.dispose(() => void (globalThis as any).disposed.push(${JSON.stringify(version)}));
    export default class Tally extends Model {
      static ttl = 60;
      total = 0;
      ${fields}
      async add(by: number) { return (this.total += by); }
      async slow() { const was = this; await (globalThis as any).gate; return was.get(null); }
      async label() { return label + ${JSON.stringify(version)}; }
    }
  `;

  const LIB = (label: string) => `export const label = ${JSON.stringify(label)};`;

  const fresh = () => {
    g.loads = [];
    g.disposed = [];
  };

  it("will restart in place when a server edit reaches no accept boundary", async () => {
    fresh();
    let open!: () => void;
    g.gate = new Promise<void>(resolve => (open = resolve));

    const { edit, post, listen, stats } = await serve({ "app/tally/remote.ts": SEAT("v1"), "app/tally/lib.ts": LIB("a") });
    const id = tab();
    const twin = { "x-expressive-twin": "Tally-A" };
    const stream = await listen(id);

    const first = await post(id, "/tally", { "x-expressive-call": "default.add", ...twin }, "[2]");
    const slow = post(id, "/tally", { "x-expressive-call": "default.slow", ...twin });

    await until(() => g.loads.length === 1);
    expect(await stats()).toMatchObject({ seats: 1, twins: 1 });

    edit("app/tally/remote.ts", SEAT("v2"));
    await until(() => g.loads.length === 2);

    expect(g.disposed).toEqual(["v1"]);
    expect(await stats()).toMatchObject({ seats: 0, layers: 0, twins: 0, watchers: 0 });
    await until(() => stream.hellos.length === 2);
    expect(stream.hellos[1]).not.toBe(first.epoch);

    open();
    expect((await slow).value).toBe(true);

    const after = await post(id, "/tally", { "x-expressive-call": "default.add", ...twin }, "[1]");
    expect(after).toMatchObject({ value: 1, epoch: stream.hellos[1] });
  });

  it("will restart when an edit bubbles up to an importer with no accept boundary", async () => {
    fresh();
    const { edit, post } = await serve({ "app/tally/remote.ts": SEAT("v1"), "app/tally/lib.ts": LIB("a") });
    const id = tab();

    const before = await post(id, "/tally", { "x-expressive-call": "default.label", "x-expressive-twin": "Tally-A" });
    edit("app/tally/lib.ts", LIB("b"));
    await until(() => g.loads.length === 2);

    const after = await post(id, "/tally", { "x-expressive-call": "default.label", "x-expressive-twin": "Tally-A" });
    expect(after).toMatchObject({ value: "bv1" });
    expect(after.epoch).not.toBe(before.epoch);
  });

  it("will not restart when an edit bubbles up to an importer's accept boundary", async () => {
    fresh();
    const accepting = SEAT("v1") + "\nimport.meta.hot?.accept();";
    const { edit, post } = await serve({ "app/tally/remote.ts": accepting, "app/tally/lib.ts": LIB("a") });
    const id = tab();

    const before = await post(id, "/tally", { "x-expressive-call": "default.label", "x-expressive-twin": "Tally-A" });
    edit("app/tally/lib.ts", LIB("b"));
    await until(() => g.loads.length === 2);

    const after = await post(id, "/tally", { "x-expressive-call": "default.label", "x-expressive-twin": "Tally-A" });
    expect(after).toMatchObject({ value: "bv1", epoch: before.epoch });
    expect(g.disposed).toEqual(["v1"]);
  });

  it("will patch a method edit into the running seat, a call in flight finishing on the old code", async () => {
    fresh();
    let open!: () => void;
    g.gate = new Promise<void>(resolve => (open = resolve));

    const { edit, post, stats } = await serve({ "app/tally/remote.ts": SEAT("v1"), "app/tally/lib.ts": LIB("a") }, true);
    const id = tab();
    const twin = { "x-expressive-twin": "Tally-A" };

    const first = await post(id, "/tally", { "x-expressive-call": "default.add", ...twin }, "[2]");
    const slow = post(id, "/tally", { "x-expressive-call": "default.slow", ...twin });
    await until(() => g.loads.length === 1);
    const baseline = await stats();

    edit("app/tally/remote.ts", SEAT("v2"));
    await until(() => g.loads.length === 2);

    expect(await post(id, "/tally", { "x-expressive-call": "default.label", ...twin })).toMatchObject({ value: "av2", epoch: first.epoch });
    expect(await post(id, "/tally", { "x-expressive-call": "default.add", ...twin }, "[1]")).toMatchObject({ value: 3, epoch: first.epoch });

    open();
    expect((await slow).value).toBe(false);
    expect(await stats()).toEqual(baseline);
  });

  it("will retire only a replaced class's seats, renewing the epoch of connections holding them", async () => {
    fresh();
    const OTHER = `import { Model } from "@expressive/mvc"; export default class Note extends Model { static ttl = 60; text = ""; async write(text: string) { return (this.text = text); } }`;
    const { edit, post, listen, stats } = await serve({ "app/tally/remote.ts": SEAT("v1"), "app/tally/lib.ts": LIB("a"), "app/note/remote.ts": OTHER }, true);
    const [holder, bystander] = [tab(), tab()];
    const stream = await listen(holder);

    await post(holder, "/tally", { "x-expressive-call": "default.add", "x-expressive-twin": "Tally-A" }, "[2]");
    const note = await post(bystander, "/note", { "x-expressive-call": "default.write", "x-expressive-twin": "Note-A" }, '["hi"]');
    expect(await stats()).toMatchObject({ seats: 2, twins: 2 });

    edit("app/tally/remote.ts", SEAT("v2", "count = 0;"));
    await until(() => stream.hellos.length === 2);

    expect(g.disposed).toEqual(["v1"]);
    expect(await stats()).toMatchObject({ seats: 1, twins: 1 });
    expect(await post(holder, "/tally", { "x-expressive-call": "default.add", "x-expressive-twin": "Tally-A" }, "[1]")).toMatchObject({ value: 1, epoch: stream.hellos[1] });
    expect(await post(bystander, "/note", { "x-expressive-get": "default", "x-expressive-twin": "Note-A" })).toMatchObject({ epoch: note.epoch });
  });

  it("will patch through a Model module's boundary when a function module it imports changes", async () => {
    fresh();
    const { edit, post } = await serve({ "app/tally/remote.ts": SEAT("v1"), "app/tally/lib.ts": LIB("a") }, true);
    const id = tab();
    const twin = { "x-expressive-twin": "Tally-A" };

    const before = await post(id, "/tally", { "x-expressive-call": "default.add", ...twin }, "[2]");
    edit("app/tally/lib.ts", "export const label = 'b'; export function unused() {}");
    await until(() => g.loads.length === 2);

    expect(await post(id, "/tally", { "x-expressive-call": "default.label", ...twin })).toMatchObject({ value: "bv1", epoch: before.epoch });
    expect(await post(id, "/tally", { "x-expressive-call": "default.add", ...twin }, "[1]")).toMatchObject({ value: 3, epoch: before.epoch });
  });

  it("will dispose a module's top-level side effects before running it again", async () => {
    fresh();
    g.open = 0;
    const DB = (version: string) => `
      await Promise.resolve();
      (globalThis as any).open++;
      import.meta.hot?.dispose(async () => { await Promise.resolve(); (globalThis as any).open--; });
      export const db = ${JSON.stringify(version)};
    `;
    const remote = `import { db } from "./db"; (globalThis as any).loads.push(db); export async function which() { return db; }`;
    const { edit, post } = await serve({ "app/store/remote.ts": remote, "app/store/db.ts": DB("one") });
    const id = tab();

    expect(await post(id, "/store", { "x-expressive-call": "which" })).toMatchObject({ value: "one" });

    edit("app/store/db.ts", DB("two"));
    await until(() => g.loads.length === 2);

    expect(g.open).toBe(1);
    expect(await post(id, "/store", { "x-expressive-call": "which" })).toMatchObject({ value: "two" });
  });

  it("will return every count to its baseline after load and reloads", async () => {
    fresh();
    const CART = (fields = "") => `
      import { Model } from "@expressive/mvc";
      (globalThis as any).loads.push("cart");
      export class Cart extends Model { items = 0; ${fields} async add() { return ++this.items; } }
    `;
    const QUICK = `import { Model } from "@expressive/mvc"; export default class Hit extends Model { static ttl = 0; hits = 0; async hit() { return ++this.hits; } }`;
    const PING = (n: number) => `(globalThis as any).loads.push("ping"); export async function ping() { return ${n}; }`;
    const { edit, post, listen, stats } = await serve({ "app/shop/remote.ts": CART(), "app/hit/remote.ts": QUICK, "app/ping/remote.ts": PING(0) }, true);
    const tabs = Array.from({ length: 6 }, tab);
    const reloads: [string, string, number][] = [
      ["app/shop/remote.ts", CART() + "\n// patched", 6],
      ["app/shop/remote.ts", CART("count = 0;"), 0],
      ["app/ping/remote.ts", PING(1), 0],
    ];

    await post(tabs[0], "/ping", { "x-expressive-call": "ping" });
    const baseline = await stats();

    for (const [file, src, left] of reloads) {
      const streams = await Promise.all(tabs.map(listen));

      await Promise.all(tabs.map(async (id, i) => {
        await post(id, "/shop", { "x-expressive-get": "/shop#Cart", "x-expressive-twin": `Cart-${i}` });

        for (let call = 0; call < 4; call++) {
          await post(id, "/shop", { "x-expressive-call": "/shop#Cart.add", "x-expressive-twin": `Cart-${i}` });
          await post(id, "/hit", { "x-expressive-call": "default.hit" });
        }
      }));

      expect(await stats()).toMatchObject({ twins: 6, pooled: 6, seats: 0 });

      const loaded = g.loads.length;
      edit(file, src);
      await until(() => g.loads.length > loaded);

      expect(await stats()).toMatchObject({ twins: left, pooled: left, seats: 0 });
      streams.forEach(stream => stream.close());
    }

    await Promise.all(tabs.map((id, i) => post(id, "/ping", { "x-expressive-call": "ping", "x-expressive-release": `Cart-${i}` })));

    expect(await stats()).toEqual({ ...baseline, connections: baseline.connections + tabs.length - 1 });
  });
});

describe("reloads", () => {
  it("will retire a replaced class without a hot client, until stopped", () => {
    class Tally extends Model { total = 0; }
    const stop = reloads({} as ModuleRunner);
    const before = construct(Tally, true);

    accept("/reload-test.ts", { Tally });
    accept("/reload-test.ts", { Tally: class Tally extends Model { total = 0; count = 0; } });
    expect(before.instance.get(null)).toBe(true);

    stop();

    const after = construct(Tally, true);
    accept("/reload-test.ts", { Tally: class Tally extends Model { total = 0; } });
    expect(after.instance.get(null)).toBe(false);
    after.drop();
  });
});
