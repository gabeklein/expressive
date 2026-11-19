import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("bare", () => {
  it("will write env.d.ts and warn without failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    files({ ".env.example": "A=\nB=", ".env": "A=1" });

    expect(await run()).toBe(0);
    expect(file("env.d.ts")).toContain("readonly A: string;");
    expect(await run()).toBe(0);
    expect(logged()).toEqual(["Wrote env.d.ts.", "env.d.ts is current."]);
    expect(warn.mock.calls.map(call => call[0])).toEqual(["B is unset - .env.example lists it.", "B is unset - .env.example lists it."]);
  });

  it("will pass without .env files", async () => {
    expect(await run()).toBe(0);
    expect(logged()).toEqual([`No .env files in ${root} - nothing to prepare.`]);
    expect(existsSync(join(root, "env.d.ts"))).toBe(false);
  });

  it("will still print help", async () => {
    expect(await run("--help")).toBe(0);
    expect(out.log).toHaveBeenCalled();
  });
});

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
    expect(logged().pop()).toBe("env.d.ts declares every key; every key in .env.example is set.");
  });

  it("will fail on unset, empty and stale", async () => {
    files({ ".env.example": "A=\nB=\nC=", ".env": "A=\nC=1", ".env.production": "B=1" });

    expect(await run("check")).toBe(1);
    expect(errors()).toEqual([
      "A is empty - .env.example lists it.",
      "B is unset - .env.example lists it.",
      "env.d.ts does not declare A, B, C - run `expressive env`.",
    ]);
  });

  it("will say when there is no example", async () => {
    files({ ".env": "A=1" });
    await run("sync");

    expect(await run("check")).toBe(0);
    expect(logged().pop()).toBe("env.d.ts declares every key; no .env.example to check values against.");
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
      "A  6 chars  .env:1",
      "B  <empty>  .env:2",
      "C  3 chars  process.env",
      "D  <unset>  .env.example:4",
      "E  2 chars  .env.local:1",
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

  it("will print several values, one per line", async () => {
    files({ ".env": "A=one\nB=two" });

    expect(await run("read", "A", "B")).toBe(0);
    expect(stdout).toHaveBeenCalledWith("one\ntwo\n");
  });

  it("will print lengths", async () => {
    files({ ".env": "A=secret\nB=" });

    expect(await run("read", "A", "B", "--length")).toBe(0);
    expect(stdout).toHaveBeenCalledWith("6\n0\n");
  });

  it("will print nothing when any key is unset", async () => {
    files({ ".env": "A=1" });

    expect(await run("read", "A", "B", "C")).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(errors()).toEqual(["Not set: B, C."]);
  });

  it("will reject a malformed key", async () => {
    expect(await run("read", "no spaces")).toBe(2);
  });
});

describe("write", () => {
  it("will append to .env and sync types", async () => {
    expect(await run("write", "A=1")).toBe(0);
    expect(file(".env")).toBe("A=1\n");
    expect(file("env.d.ts")).toContain("readonly A: string;");
    expect(logged()).toEqual(["Set A in .env (1 chars)."]);
  });

  it("will set several keys", async () => {
    files({ ".env": "A=old" });

    expect(await run("write", "A=1", "B=2")).toBe(0);
    expect(file(".env")).toBe("A=1\nB=2\n");
    expect(logged()).toEqual(["Set A in .env (1 chars).", "Set B in .env (1 chars)."]);
  });

  it("will replace a key in place", async () => {
    files({ ".env": "# doc\nexport A=old\nB=2" });

    expect(await run("write", "A=new")).toBe(0);
    expect(file(".env")).toBe("# doc\nexport A=new\nB=2");
  });

  it("will replace the winning duplicate and a multi-line value", async () => {
    files({ ".env": "A=first\nA='multi\nline'\nB=2\r\n" });

    await run("write", "A=x");
    expect(file(".env")).toBe("A=first\r\nA=x\r\nB=2\r\n");
  });

  it("will empty a key", async () => {
    files({ ".env": "A=1" });

    await run("write", "A=");
    expect(file(".env")).toBe("A=");
  });

  it("will keep = in a value", async () => {
    await run("write", "A=b=c");
    expect(file(".env")).toBe("A=b=c\n");
  });

  it("will add a newline before appending", async () => {
    files({ ".env": "A=1" });

    await run("write", "B=2");
    expect(file(".env")).toBe("A=1\nB=2\n");
  });

  it("will write to the given file", async () => {
    await run("write", "A=1", "--file", ".env.local");
    expect(file(".env.local")).toBe("A=1\n");
  });

  it("will read a bare file name as .env.<name>", async () => {
    await run("write", "A=", "-f", "example");
    await run("write", "B=1", "-f", "production.local");
    await run("write", "C=1", "-f", "./plain");

    expect(file(".env.example")).toBe("A=\n");
    expect(file(".env.production.local")).toBe("B=1\n");
    expect(file("plain")).toBe("C=1\n");
    expect(logged()).toContain("Set A in .env.example (0 chars).");
  });

  it("will quote values the parser would misread", async () => {
    await run("write", "A=two words", "B=it's # \"x\"", "C=line\nnext");

    expect(file(".env")).toBe("A='two words'\nB=`it's # \"x\"`\nC='line\nnext'\n");
  });

  it("will write nothing when a value can't be quoted", async () => {
    expect(await run("write", "A=1", "B=it's `x`")).toBe(1);
    expect(existsSync(join(root, ".env"))).toBe(false);
  });

  it("will read a bare key's value from stdin", async () => {
    piped.mockResolvedValueOnce("from-pipe");

    expect(await run("write", "A", "B=2")).toBe(0);
    expect(file(".env")).toBe("A=from-pipe\nB=2\n");
  });

  it("will refuse empty stdin", async () => {
    files({ ".env": "A=secret" });
    piped.mockResolvedValueOnce("");

    expect(await run("write", "A")).toBe(2);
    expect(file(".env")).toBe("A=secret");
    expect(errors()).toEqual(["stdin was empty - A= empties a key."]);
  });

  it("will fail with no value and no pipe", async () => {
    piped.mockResolvedValueOnce(undefined);

    expect(await run("write", "A")).toBe(2);
    expect(errors()).toEqual(["Give A a value - A=value - or pipe one in."]);
  });

  it("will refuse two bare keys", async () => {
    expect(await run("write", "A", "B", "C")).toBe(2);
    expect(errors()).toEqual(["Only one key can read stdin - give B, C as KEY=value."]);
  });

  it("will reject a malformed pair", async () => {
    expect(await run("write", "1A=x")).toBe(2);
  });
});

describe("unset", () => {
  it("will remove keys with their docs, keeping sections", async () => {
    files({ ".env": "# Database\n\n# Doc.\nA=1\nB='multi\nline'\nC=3\nA=again\n" });

    expect(await run("unset", "A", "B")).toBe(0);
    expect(file(".env")).toBe("# Database\n\nC=3\n");
    expect(file("env.d.ts")).not.toContain("readonly A");
    expect(logged()).toEqual(["Removed A from .env.", "Removed B from .env."]);
  });

  it("will say where a removed key is still set", async () => {
    files({ ".env": "A=1", ".env.local": "A=2" });

    await run("unset", "A");
    expect(logged()).toEqual(["Removed A from .env - still set by .env.local:1."]);
  });

  it("will remove from the given file", async () => {
    files({ ".env.local": "A=1\nB=2" });

    expect(await run("unset", "A", "-f", "local")).toBe(0);
    expect(file(".env.local")).toBe("B=2");
  });

  it("will fail for a key not in the file", async () => {
    files({ ".env": "A=1" });

    expect(await run("unset", "A", "B")).toBe(1);
    expect(file(".env")).toBe("");
    expect(errors()).toEqual(["B is not in .env."]);
  });

  it("will fail without the file", async () => {
    expect(await run("unset", "A")).toBe(1);
    expect(existsSync(join(root, ".env"))).toBe(false);
  });
});
