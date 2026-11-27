import { beforeAll, describe, expect, it, vi } from "vitest";
import { Model } from "@expressive/mvc";

import { attempt, fault, inFolder, locate, verify, type Endpoint, type Seats } from "./call";
import { Current, install } from "./context";

const at = (...pattern: string[]): Endpoint => ({ pattern, exports: async () => ({ calls: {}, classes: {} }) });
const resolve = async (endpoints: Endpoint[], path: string[]) => (await locate(endpoints, path)).found;

describe("call endpoints", () => {
  const endpoints = [at("blog", ":slug"), at("blog", "new"), at("docs", "*"), at()];

  it("will match a path to the most specific endpoint", async () => {
    expect((await resolve(endpoints, ["blog", "new"]))?.endpoint.pattern).toEqual(["blog", "new"]);
    expect((await resolve(endpoints, ["blog", "hello"]))?.endpoint.pattern).toEqual(["blog", ":slug"]);
    expect((await resolve(endpoints, ["docs", "a", "b"]))?.endpoint.pattern).toEqual(["docs", "*"]);
    expect((await resolve(endpoints, []))?.endpoint.pattern).toEqual([]);
  });

  it("will bind a path's segments to the endpoint's pattern", async () => {
    expect((await resolve(endpoints, ["blog", "hello"]))?.segments).toEqual(["blog", "hello"]);
    expect((await resolve(endpoints, ["docs", "a", "b"]))?.segments).toEqual(["docs", "a/b"]);
  });

  it("will prefer a param to a catch-all", async () => {
    expect((await resolve([at("docs", "*"), at("docs", ":page")], ["docs", "a"]))?.endpoint.pattern).toEqual(["docs", ":page"]);
  });

  it("will prefer a folder to its catch-all sibling for the folder's own path", async () => {
    expect((await resolve([at("blog", "*"), at("blog")], ["blog"]))?.endpoint.pattern).toEqual(["blog"]);
    expect((await resolve([at("*"), at()], []))?.endpoint.pattern).toEqual([]);
    expect((await resolve([at("*"), at()], ["a"]))?.endpoint.pattern).toEqual(["*"]);
  });

  it("will not match a path no endpoint owns", async () => {
    expect(await resolve(endpoints, ["blog"])).toBeUndefined();
    expect(await resolve(endpoints, ["blog", "a", "b"])).toBeUndefined();
  });
});

describe("verify", () => {
  it("will throw if an exported class is not an Error subclass", () => {
    expect(() => verify("/tally", { calls: {}, classes: { Ok: class extends Error {} } })).not.toThrow();
    expect(() => verify("/tally", { calls: {}, classes: { Bad: class {} } })).toThrow("/tally exports Bad, which is neither an async function nor an Error subclass.");
    expect(() => verify("/tally", { calls: {}, classes: { Odd: 1 } })).toThrow("exports Odd");
  });
});

describe("a call", () => {
  class Limit extends Error {
    status = 409;
    constructor(public limit: number) { super(`Over ${limit}`); }
  }
  class Odd extends Error { status = "odd"; }
  class Known extends Error {}
  class Tally extends Model { total = 7; }

  const calls: Record<string, unknown> = {
    add: async (a: number, b: number) => a + b,
    path: async () => Current.get().url.pathname,
    total: async () => Tally.get().total,
    limit: async () => { throw new Limit(3); },
    odd: async () => { throw new Odd("Odd"); },
    known: async () => { throw new Known("Known"); },
    fail: async () => { throw new Error("Nope"); },
    raw: async () => { throw "raw"; },
  };
  const endpoints: Endpoint[] = [
    { pattern: ["tally", ":id"], exports: async () => ({ calls, classes: { "/tally#Limit": Limit, "/tally#Odd": Odd, "/tally#Known": Known } }) },
  ];
  const request = new Request("http://localhost/tally/a");
  const invoke = async (at: string[], name: string, args: unknown[], { seats = async () => undefined, dev = false, errors }: { seats?: Seats; dev?: boolean; errors?: Record<string, unknown> } = {}) => {
    const { found, fn } = await locate(endpoints, at, name);

    if (fn) return attempt(() => inFolder({ request, found, seats }, () => fn(...args)), endpoints, dev, errors);
  };
  const run = (name: string, args: unknown[] = [], options?: Parameters<typeof invoke>[3]) => invoke(["tally", "a"], name, args, options);

  beforeAll(() => install());

  it("will run a call in its folder and give back its value", async () => {
    expect(await run("add", [1, 2])).toEqual({ value: 3 });
    expect(await run("path")).toEqual({ value: "/tally/a" });
  });

  it("will seat the folders along the call's path", async () => {
    const seats = async (pattern: string[]) => (pattern.length === 2 ? Tally : undefined);

    expect(await run("total", [], { seats })).toEqual({ value: 7 });
  });

  it("will give back nothing for a name or a path no endpoint has", async () => {
    expect(await run("subtract")).toBeUndefined();
    expect(await invoke(["nope"], "add", [])).toBeUndefined();
  });

  it("will give back an exported error's id, fields and numeric status", async () => {
    expect(await run("limit")).toEqual({ error: { error: "/tally#Limit", message: "Over 3", status: 409, limit: 3 }, status: 409 });
    expect(await run("odd")).toEqual({ error: { error: "/tally#Odd", message: "Odd", status: "odd" }, status: undefined });
  });

  it("will prefer a known id to an exported one", async () => {
    expect(await run("known", [], { errors: { "fixed:Known": Known } })).toMatchObject({ error: { error: "fixed:Known" } });
  });

  it("will hide any other error's message outside development", async () => {
    expect(await run("fail")).toEqual({ error: { message: "Internal error." } });
    expect(await run("raw", [], { dev: true })).toEqual({ error: { message: "Internal error." } });

    const outcome = await run("fail", [], { dev: true });
    expect(outcome).toMatchObject({ error: { message: "Nope", stack: expect.stringContaining("Error: Nope") } });
  });
});

describe("fault", () => {
  it("will warn once per class, in development, of an error class it does not know", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    class Unlisted extends Error {}

    try {
      expect(await fault(new Unlisted("Odd"), [], true)).toMatchObject({ error: { message: "Odd" } });
      await fault(new Unlisted("Again"), [], true);
      await fault(new TypeError("Bug"), [], true);
      await fault(new Unlisted("Built"), [], false);

      expect(warn.mock.calls).toEqual([[`Unlisted is not a known error class, so a build replies "Internal error." for it - export it from a module the client calls, or list it in errors.`]]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("error ids", () => {
  it("will find the nearest exported or known class of an error", async () => {
    class Base extends Error {}
    class Mid extends Base {}
    class Leaf extends Mid {}
    const endpoints: Endpoint[] = [{ pattern: [], exports: async () => ({ calls: {}, classes: { "#Base": Base } }) }];

    expect((await fault(new Leaf(), endpoints, false)).error.error).toBe("#Base");
    expect((await fault(new Leaf(), endpoints, false, { "#Mid": Mid })).error.error).toBe("#Mid");
    expect((await fault(new Error(), endpoints, false)).error.error).toBeUndefined();
  });
});
