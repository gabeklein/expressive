import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { client, exposed } from "./client";

describe("exposed", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "env-"));
    writeFileSync(join(root, ".env"), "PUBLIC_URL=file\nPUBLIC_NAME=file\nSECRET=s3cret");
    vi.stubEnv("PUBLIC_NAME", "process");
    vi.stubEnv("PUBLIC_EXTRA", "process");
    vi.stubEnv("OTHER", "process");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("will expose prefixed keys from files and process.env", () => {
    expect(exposed(root, "development", "PUBLIC_")).toEqual({
      PUBLIC_URL: "file",
      PUBLIC_NAME: "process",
      PUBLIC_EXTRA: "process",
    });
  });

  it("will expose every file key, and no other process.env key, without a prefix", () => {
    expect(exposed(root, "development", false)).toEqual({
      PUBLIC_URL: "file",
      PUBLIC_NAME: "process",
      SECRET: "s3cret",
    });
  });
});

describe("client", () => {
  const evaluate = async (source: string) =>
    (await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`)).env as Record<string | symbol, unknown>;

  it("will serve values and throw on a server-only key", async () => {
    const env = await evaluate(client({ PUBLIC_URL: "x" }, "PUBLIC_"));

    expect(env.PUBLIC_URL).toBe("x");
    expect(() => env.SECRET).toThrow("env.SECRET is server-only - name it PUBLIC_SECRET to expose it to the client.");
    expect(() => env.PUBLIC_MISSING).toThrow("env.PUBLIC_MISSING was not set when the client was built.");
  });

  it("will not throw for probes", async () => {
    const env = await evaluate(client({}, "PUBLIC_"));

    expect(env.toJSON).toBeUndefined();
    expect(env.then).toBeUndefined();
    expect(env[Symbol.toPrimitive]).toBeUndefined();
    expect(JSON.stringify(env)).toBe("{}");
  });

  it("will refuse writes", async () => {
    const env = await evaluate(client({}, "PUBLIC_"));

    expect(() => { env.PUBLIC_URL = "y"; }).toThrow(TypeError);
  });

  it("will throw on register in either form", async () => {
    for (const source of [client({}, "PUBLIC_"), client({}, false)]) {
      const { register } = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`);
      expect(() => register()).toThrow("register() fills process.env - call it on the server.");
    }
  });

  it("will serve a frozen object without a prefix", async () => {
    const env = await evaluate(client({ SECRET: "s" }, false));

    expect(env.SECRET).toBe("s");
    expect(env.MISSING).toBeUndefined();
    expect(Object.isFrozen(env)).toBe(true);
  });
});
