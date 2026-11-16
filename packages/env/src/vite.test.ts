import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createLogger, createServer, type Rollup, type ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "./vite";

const reset = vi.hoisted(() => vi.fn());

vi.mock("./env", () => ({ reset }));

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "env-")));
  writeFileSync(join(root, ".env"), "PUBLIC_URL=https://public.test\nSECRET=s3cret\n");
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

  it("will honor a custom prefix", async () => {
    writeFileSync(join(root, ".env"), "CLIENT_URL=https://client.test\nPUBLIC_URL=https://public.test\n");
    const code = await bundle(env({ prefix: "CLIENT_" }));

    expect(code).toContain("https://client.test");
    expect(code).not.toContain("https://public.test");
  });
});

describe("plugin", () => {
  it("will leave server imports alone", () => {
    const plugin = env() as { resolveId(id: string, importer?: string, options?: { ssr?: boolean }): unknown; load(id: string): unknown };

    expect(plugin.resolveId("@expressive/env", undefined, { ssr: true })).toBeUndefined();
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

  it("will write env.d.ts on start", () => {
    expect(readFileSync(join(root, "env.d.ts"), "utf8")).toContain("readonly PUBLIC_URL: string;");
  });

  it("will refresh types, server values and the client when a .env file changes", async () => {
    const send = vi.spyOn(server.ws, "send");

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

    expect(reset).not.toHaveBeenCalled();
  });

  it("will reload before the client has loaded env", () => {
    const send = vi.spyOn(server.ws, "send");
    server.watcher.emit("all", "change", join(root, ".env"));

    expect(send).toHaveBeenCalledWith({ type: "full-reload" });
  });
});
