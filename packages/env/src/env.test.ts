import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { env, reset } from "./env";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "env-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("NODE_ENV", "");
  reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const write = (files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
};

const read = env as unknown as Record<string | symbol, string | undefined>;

it("will read keys from .env", () => {
  write({ ".env": "DATABASE_URL=pg://local\n" });

  expect(read.DATABASE_URL).toBe("pg://local");
});

it("will layer files for the mode, later winning", () => {
  write({
    ".env": "A=base\nB=base\nC=base\nD=base",
    ".env.local": "B=local\nC=local\nD=local",
    ".env.development": "C=mode\nD=mode",
    ".env.development.local": "D=mode-local",
    ".env.production": "A=prod",
  });

  expect([read.A, read.B, read.C, read.D]).toEqual(["base", "local", "mode", "mode-local"]);
});

it("will take mode from NODE_ENV", () => {
  vi.stubEnv("NODE_ENV", "production");
  write({ ".env": "A=base", ".env.production": "A=prod" });

  expect(read.A).toBe("prod");
});

it("will prefer process.env over files", () => {
  vi.stubEnv("A", "process");
  write({ ".env": "A=file" });

  expect(read.A).toBe("process");
});

it("will not read files until a key is read", () => {
  const before = env;
  write({ ".env": "A=late" });

  expect(before).toBe(env);
  expect(read.A).toBe("late");
});

it("will cache files until reset", () => {
  write({ ".env": "A=one" });
  expect(read.A).toBe("one");

  write({ ".env": "A=two" });
  expect(read.A).toBe("one");

  reset();
  expect(read.A).toBe("two");
});

it("will list, spread and test keys", () => {
  write({ ".env": "FROM_FILE=1" });

  expect("FROM_FILE" in env).toBe(true);
  expect("MISSING_KEY" in env).toBe(false);
  expect(Object.keys(env)).toContain("FROM_FILE");
  expect({ ...env }).toMatchObject({ FROM_FILE: "1" });
});

it("will return undefined for symbols", () => {
  expect(read[Symbol.iterator]).toBeUndefined();
});

it("will throw on write", () => {
  expect(() => { read.A = "x"; }).toThrow(TypeError);
  expect(process.env.A).toBeUndefined();
});

it("will not write process.env", () => {
  write({ ".env": "ONLY_IN_FILE=1" });

  expect(read.ONLY_IN_FILE).toBe("1");
  expect(process.env.ONLY_IN_FILE).toBeUndefined();
});

it("will skip a directory named like a .env file", () => {
  mkdirSync(join(root, ".env"));
  write({ ".env.local": "A=1" });

  expect(read.A).toBe("1");
});

it("will read past a byte order mark", () => {
  write({ ".env": "\uFEFFA=1" });

  expect(read.A).toBe("1");
});
