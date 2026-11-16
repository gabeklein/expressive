import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { envFiles, scan, where } from "./files";

describe("scan", () => {
  it("will list keys in order", () => {
    expect(scan("A=1\nexport B=2\n\nC=3").map(key => key.name)).toEqual(["A", "B", "C"]);
  });

  it("will attach a comment block above a key as its doc", () => {
    const [a, b] = scan("# Postgres URL.\n# Pooled.\nA=1\nB=2");

    expect(a).toEqual({ name: "A", doc: "Postgres URL.\nPooled.", section: undefined, line: 2, start: 0, end: 3 });
    expect(b.doc).toBeUndefined();
  });

  it("will take a comment block before a blank line as the section", () => {
    const keys = scan("# Database\n\nA=1\n# Pool size.\nB=2\n\n# Mail\n\nC=3");

    expect(keys).toEqual([
      { name: "A", doc: undefined, section: "Database", line: 2, start: 2, end: 3 },
      { name: "B", doc: "Pool size.", section: "Database", line: 4, start: 3, end: 5 },
      { name: "C", doc: undefined, section: "Mail", line: 8, start: 8, end: 9 },
    ]);
  });

  it("will keep the section across a blank comment block", () => {
    expect(scan("# Database\n\nA=1\n#\n\nB=2")[1].section).toBe("Database");
  });

  it("will ignore commented-out keys", () => {
    const keys = scan("# Doc lost to the old key.\n# OLD=1\nA=1");

    expect(keys).toEqual([{ name: "A", doc: undefined, section: undefined, line: 2, start: 2, end: 3 }]);
  });

  it("will skip the lines of a multi-line value", () => {
    const keys = scan("KEY='-----BEGIN\n# not a comment\nNOT=a key\nEND-----'\nB=\"one line\"\nC=2");

    expect(keys.map(({ name, line, end }) => [name, line, end])).toEqual([["KEY", 0, 4], ["B", 4, 5], ["C", 5, 6]]);
  });
});

describe("files", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "env-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("will order .env.example and .env first", () => {
    for (const name of [".env.production", ".env", ".env.example", ".env.local", "env.d.ts", ".envrc"])
      writeFileSync(join(root, name), "");

    expect(envFiles(root)).toEqual([".env.example", ".env", ".env.local", ".env.production"]);
  });

  it("will name the file and line a key comes from", () => {
    writeFileSync(join(root, ".env"), "A=1\nB=1\nA=2");
    writeFileSync(join(root, ".env.local"), "\nB=2");
    vi.stubEnv("C", "3");

    expect(where(root, "development", "A")).toBe(".env:3");
    expect(where(root, "development", "B")).toBe(".env.local:2");
    expect(where(root, "development", "C")).toBe("process.env");
    expect(where(root, "development", "D")).toBeUndefined();
  });
});
