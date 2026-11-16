import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command } from "@expressive/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Env from "./command";

const piped = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>());

vi.mock("./stdin", () => ({ piped }));

let root: string;
let log: { mock: { calls: unknown[][] } };
let error: { mock: { calls: unknown[][] } };
let stdout: object;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "env-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("NODE_ENV", "");
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const out = { log: vi.fn(), error: vi.fn() };
const run = (...argv: string[]) => command(Env)(argv, out);
const files = (files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
};
const file = (name: string) => readFileSync(join(root, name), "utf8");
const logged = () => log.mock.calls.map(call => call[0]);
const errors = () => error.mock.calls.map(call => call[0]);

describe("sync", () => {
  it("will write env.d.ts", async () => {
    files({ ".env": "A=1" });

    expect(await run("sync")).toBe(0);
    expect(file("env.d.ts")).toContain("readonly A: string;");
    expect(await run("sync")).toBe(0);
    expect(logged()).toEqual(["Wrote env.d.ts.", "env.d.ts is current."]);
  });

  it("will fail without .env files", async () => {
    expect(await run("sync")).toBe(1);
    expect(errors()).toEqual([`No .env files in ${root}.`]);
  });
});

describe("check", () => {
  it("will pass when every example key is set", async () => {
    files({ ".env.example": "A=\nB=", ".env": "A=1" });
    vi.stubEnv("B", "2");
    await run("sync");

    expect(await run("check")).toBe(0);
    expect(logged().pop()).toBe("Every key in .env.example is set; env.d.ts is current.");
  });

  it("will fail on unset, empty and stale", async () => {
    files({ ".env.example": "A=\nB=\nC=", ".env": "A=\nC=1", ".env.production": "B=1" });

    expect(await run("check")).toBe(1);
    expect(errors()).toEqual([
      "A is empty - .env.example lists it.",
      "B is unset - .env.example lists it.",
      "env.d.ts is out of date - run `expressive env sync`.",
    ]);
  });

  it("will check the given mode", async () => {
    files({ ".env.example": "B=", ".env.production": "B=1" });
    await run("sync");

    expect(await run("check", "--mode", "production")).toBe(0);
  });
});

describe("list", () => {
  it("will list state and source without values", async () => {
    files({ ".env.example": "A=\nB=\nC=\nD=", ".env": "A=secret\nB=", ".env.local": "E=xy" });
    vi.stubEnv("C", "env");

    expect(await run("list")).toBe(0);
    expect(logged()).toEqual([
      "A  6 chars  .env",
      "B  <empty>  .env",
      "C  3 chars  process.env",
      "D  <unset>  .env.example",
      "E  2 chars  .env.local",
    ]);
    expect(logged().join("\n")).not.toContain("secret");
  });

  it("will list nothing without files", async () => {
    expect(await run("list")).toBe(0);
    expect(logged()).toEqual([]);
  });
});

describe("read", () => {
  it("will print the raw value", async () => {
    files({ ".env": "A=secret" });

    expect(await run("read", "A")).toBe(0);
    expect(stdout).toHaveBeenCalledWith("secret");
  });

  it("will print the length", async () => {
    files({ ".env": "A=secret" });

    expect(await run("read", "A", "--length")).toBe(0);
    expect(stdout).toHaveBeenCalledWith("6\n");
  });

  it("will fail when unset", async () => {
    expect(await run("read", "A")).toBe(1);
    expect(errors()).toEqual(["A is not set."]);
  });

  it("will reject a malformed key", async () => {
    expect(await run("read", "no spaces")).toBe(2);
  });
});

describe("write", () => {
  it("will append to .env and sync types", async () => {
    expect(await run("write", "A", "1")).toBe(0);
    expect(file(".env")).toBe("A=1\n");
    expect(file("env.d.ts")).toContain("readonly A: string;");
    expect(logged()).toEqual(["Set A in .env (1 chars)."]);
  });

  it("will replace a key in place", async () => {
    files({ ".env": "# doc\nexport A=old\nB=2" });

    expect(await run("write", "A", "new")).toBe(0);
    expect(file(".env")).toBe("# doc\nexport A=new\nB=2");
  });

  it("will add a newline before appending", async () => {
    files({ ".env": "A=1" });

    await run("write", "B", "2");
    expect(file(".env")).toBe("A=1\nB=2\n");
  });

  it("will write to the given file", async () => {
    await run("write", "A", "1", "--file", ".env.local");
    expect(file(".env.local")).toBe("A=1\n");
  });

  it("will quote values the parser would misread", async () => {
    await run("write", "A", "two words");
    await run("write", "B", "it's # \"x\"");
    await run("write", "C", "line\nnext");
    await run("write", "D", "");

    expect(file(".env")).toBe("A='two words'\nB=`it's # \"x\"`\nC='line\nnext'\nD=\n");
  });

  it("will refuse a value no quote can hold", async () => {
    expect(await run("write", "A", "it's `x`")).toBe(1);
  });

  it("will read the value from stdin", async () => {
    piped.mockResolvedValueOnce("from-pipe");

    expect(await run("write", "A")).toBe(0);
    expect(file(".env")).toBe("A=from-pipe\n");
  });

  it("will fail with no value and no pipe", async () => {
    piped.mockResolvedValueOnce(undefined);

    expect(await run("write", "A")).toBe(2);
    expect(errors()).toEqual(["Give A a value or pipe one in."]);
  });
});
