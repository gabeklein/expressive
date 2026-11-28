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

it("will read live bindings, then process.env, then .env files, then bound strings", async () => {
  const layered = await layeredIn({ ".env": "A=file\nB=file\nC=file\n" });
  const db = {};

  vi.stubEnv("B", "process");
  vi.stubEnv("DB", "string");

  const env = layered({ A: "bound", B: "bound", DB: db, Z: undefined }) as Record<string, unknown>;

  expect([env.A, env.B, env.C, env.DB, env.D]).toEqual(["file", "process", "file", db, undefined]);
  expect(["A", "C", "DB", "Z", "D"].map(key => key in env)).toEqual([true, true, true, true, false]);
  expect(env[Symbol.toStringTag as never]).toBeUndefined();
  expect(Object.keys(layered())).toEqual([]);
});

it("will be read-only", async () => {
  const layered = await layeredIn({});
  const env = layered({ A: 1 }) as Record<string, unknown>;

  expect(() => (env.A = 2)).toThrow(TypeError);
  expect(() => delete env.A).toThrow(TypeError);
  expect(() => Object.defineProperty(env, "B", { value: 1 })).toThrow(TypeError);
  expect([env.A, "B" in env]).toEqual([1, false]);
});
