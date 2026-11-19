import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createLogger, createServer, type Plugin, type Rollup, type ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "./vite";

const reset = vi.hoisted(() => vi.fn());

vi.mock("./env", () => ({ reset }));

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "env-")));
  writeFileSync(join(root, ".env"), "PUBLIC_URL=https://public.test\nSECRET=s3cret\n");
  mkdirSync(join(root, "node_modules/@expressive/env"), { recursive: true });
  writeFileSync(join(root, "node_modules/@expressive/env/package.json"), JSON.stringify({ name: "@expressive/env", type: "module", exports: { ".": { browser: "./browser.js", default: "./index.js" } } }));
  writeFileSync(join(root, "node_modules/@expressive/env/browser.js"), `export const env = "installed stub";`);
  writeFileSync(join(root, "node_modules/@expressive/env/index.js"), `export const env = "installed server";`);
  writeFileSync(join(root, "main.js"), `import { env } from "@expressive/env";\nexport const url = env.PUBLIC_URL;\nexport const all = env;\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("build", () => {
  const bundle = async (plugin = env(), customLogger = createLogger("silent")) => {
    const [result] = (await build({
      root,
      configFile: false,
      customLogger,
      plugins: [plugin],
      build: { write: false, lib: { entry: "main.js", formats: ["es"] } },
    })) as Rollup.RollupOutput[];

    return result.output[0].code;
  };

  it("will bundle prefixed keys and no others", async () => {
    const code = await bundle();

    expect(code).toContain("https://public.test");
    expect(code).not.toContain("s3cret");
    expect(code).not.toContain("SECRET");
  });

  it("will bundle every key and say so without a prefix", async () => {
    const logger = createLogger("silent");
    const info = vi.spyOn(logger, "info");
    const code = await bundle(env({ prefix: false }), logger);

    expect(code).toContain("s3cret");
    expect(info.mock.calls.map(call => call[0]).join("\n")).toContain("every .env key reaches the client - 2 sent, prefix is off.");
  });

  it.each(["CLIENT", "CLIENT_"])("will honor a custom prefix %s", async prefix => {
    writeFileSync(join(root, ".env"), "CLIENT_URL=https://client.test\nCLIENTELE=https://clientele.test\nPUBLIC_URL=https://public.test\n");
    const code = await bundle(env({ prefix }));

    expect(code).toContain("https://client.test");
    expect(code).not.toContain("https://clientele.test");
    expect(code).not.toContain("https://public.test");
  });
});

describe("build, shared", () => {
  const bundle = async (plugins: Plugin[]) => {
    const [result] = (await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins,
      build: { write: false, lib: { entry: "main.js", formats: ["es"] } },
    })) as Rollup.RollupOutput[];

    return result.output[0].code;
  };

  it("will drop env when nothing reads it", async () => {
    writeFileSync(join(root, "main.js"), `import { env } from "@expressive/env";\nexport const x = 1;\n`);

    expect(await bundle([env()])).not.toContain("https://public.test");
  });

  it("will defer to an earlier env()", async () => {
    writeFileSync(join(root, ".env"), "CLIENT_URL=https://client.test\nPUBLIC_URL=https://public.test\n");
    const code = await bundle([env({ prefix: "CLIENT" }), env()]);

    expect(code).toContain("https://client.test");
    expect(code).not.toContain("https://public.test");
  });
});

describe("plugin", () => {
  it("will leave server imports alone", () => {
    const plugin = env() as { resolveId(id: string, importer?: string, options?: { ssr?: boolean }): unknown; load(id: string): unknown };

    expect(plugin.resolveId("@expressive/env", undefined, { ssr: true })).toBeUndefined();
    expect(plugin.resolveId("@expressive/env", undefined, {})).toEqual({ id: "\0@expressive/env", moduleSideEffects: false });
    expect(plugin.resolveId("other", undefined, {})).toBeUndefined();
    expect(plugin.load("other")).toBeUndefined();
  });

  it("will keep the optimizer from bundling the real module", () => {
    expect((env() as unknown as { config(): unknown }).config()).toEqual({ optimizeDeps: { exclude: ["@expressive/env"] } });
  });
});

describe("dev server", () => {
  let server: ViteDevServer;

  beforeEach(async () => {
    reset.mockClear();
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [env()],
      optimizeDeps: { noDiscovery: true, include: [] },
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const virtual = () => server.environments.client.moduleGraph.getModuleById("\0@expressive/env");

  it("will not create env.d.ts", () => {
    server.watcher.emit("all", "change", join(root, ".env"));

    expect(existsSync(join(root, "env.d.ts"))).toBe(false);
  });

  it("will refresh types, server values and the client when a .env file changes", async () => {
    const send = vi.spyOn(server.ws, "send");
    writeFileSync(join(root, "env.d.ts"), "");

    await server.environments.client.transformRequest("/main.js");
    await server.environments.client.transformRequest("\0@expressive/env");
    expect(virtual()?.transformResult).toBeTruthy();

    writeFileSync(join(root, ".env.local"), "PUBLIC_ADDED=1\n");
    server.watcher.emit("all", "add", join(root, ".env.local"));

    expect(reset).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(root, "env.d.ts"), "utf8")).toContain("readonly PUBLIC_ADDED?: string;");
    expect(virtual()?.transformResult).toBeFalsy();
    expect(send).toHaveBeenCalledWith({ type: "full-reload" });
  });

  it("will ignore other files", () => {
    reset.mockClear();
    server.watcher.emit("all", "change", join(root, "main.js"));
    server.watcher.emit("all", "change", join(root, "nested", ".env"));
    server.watcher.emit("all", "change", join(root, ".env.swp"));

    expect(reset).not.toHaveBeenCalled();
  });

  it("will watch once with two env()", async () => {
    const twice = await createServer({ root, configFile: false, logLevel: "silent", plugins: [env(), env()], optimizeDeps: { noDiscovery: true, include: [] } });

    reset.mockClear();
    twice.watcher.emit("all", "change", join(root, ".env"));
    await twice.close();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("will reload before the client has loaded env", () => {
    const send = vi.spyOn(server.ws, "send");
    server.watcher.emit("all", "change", join(root, ".env"));

    expect(send).toHaveBeenCalledWith({ type: "full-reload" });
  });
});
