import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function layeredIn(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "env-"));

  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  vi.spyOn(process, "cwd").mockReturnValue(dir);

  return (await import("./env")).layered;
}

it("will read what the host bound, then process.env, then .env files", async () => {
  const layered = await layeredIn({ ".env": "A=file\nB=file\nC=file\n" });
  const db = {};

  vi.stubEnv("B", "process");
  vi.stubEnv("A", "process");

  const env = layered({ A: db, Z: undefined }) as Record<string, unknown>;

  expect([env.A, env.B, env.C, env.D]).toEqual([db, "process", "file", undefined]);
  expect(["A", "C", "Z", "D"].map(key => key in env)).toEqual([true, true, true, false]);
  expect(env[Symbol.toStringTag as never]).toBeUndefined();
  expect(Object.keys(layered())).toEqual([]);
});

it("will be read-only", async () => {
  const layered = await layeredIn({});
  const env = layered({ A: 1 }) as Record<string, unknown>;

  expect(() => (env.A = 2)).toThrow(TypeError);
  expect(env.A).toBe(1);
});
