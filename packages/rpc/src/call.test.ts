import { beforeAll, describe, expect, it, vi } from "vitest";
import { Model } from "@expressive/mvc";

import { verify, type Endpoint, type Seats } from "./call";
import { parse } from "./codec";
import { Current, install } from "./context";
import { NotFound } from "./errors";
import { dispatch } from "./http/call";

async function call(endpoints: Endpoint[], path: string, name: string, { args = [], dev = false, seats }: { args?: unknown[]; dev?: boolean; seats?: Seats } = {}) {
  const request = new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name }, body: JSON.stringify(args) });
  const response = await dispatch(request, () => endpoints, dev, seats);

  return { status: response.status, body: parse(await response.text()) as any };
}

beforeAll(() => install());

describe("call endpoints", () => {
  const at = (...pattern: string[]): Endpoint => ({ pattern, exports: async () => ({ calls: { which: async () => [pattern, Current.get().params] }, classes: {} }) });
  const endpoints = [at("blog", ":slug"), at("blog", "new"), at("docs", "*"), at()];
  const which = async (list: Endpoint[], path: string) => (await call(list, path, "which")).body.value?.[0];

  it("will match a path to the most specific endpoint", async () => {
    expect(await which(endpoints, "/blog/new")).toEqual(["blog", "new"]);
    expect(await which(endpoints, "/blog/hello")).toEqual(["blog", ":slug"]);
    expect(await which(endpoints, "/docs/a/b")).toEqual(["docs", "*"]);
    expect(await which(endpoints, "/")).toEqual([]);
  });

  it("will bind a path's segments to the endpoint's pattern", async () => {
    expect((await call(endpoints, "/blog/hello", "which")).body.value[1]).toEqual({ slug: "hello" });
    expect((await call(endpoints, "/docs/a/b", "which")).body.value[1]).toEqual({ "*": "a/b" });
  });

  it("will prefer a param to a catch-all", async () => {
    expect(await which([at("docs", "*"), at("docs", ":page")], "/docs/a")).toEqual(["docs", ":page"]);
  });

  it("will prefer a folder to its catch-all sibling for the folder's own path", async () => {
    expect(await which([at("blog", "*"), at("blog")], "/blog")).toEqual(["blog"]);
    expect(await which([at("*"), at()], "/")).toEqual([]);
    expect(await which([at("*"), at()], "/a")).toEqual(["*"]);
  });

  it("will not match a path no endpoint owns", async () => {
    expect((await call(endpoints, "/blog", "which")).status).toBe(404);
    expect((await call(endpoints, "/blog/a/b", "which")).status).toBe(404);
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
  class Tally extends Model { total = 7; }

  const calls: Record<string, unknown> = {
    add: async (a: number, b: number) => a + b,
    path: async () => Current.get().url.pathname,
    total: async () => Tally.get().total,
    limit: async () => { throw new Limit(3); },
    odd: async () => { throw new Odd("Odd"); },
    missing: async () => { throw new NotFound("Gone"); },
    fail: async () => { throw new Error("Nope"); },
    raw: async () => { throw "raw"; },
  };
  const endpoints: Endpoint[] = [
    { pattern: ["tally", ":id"], exports: async () => ({ calls, classes: { "/tally#Limit": Limit, "/tally#Odd": Odd, "/tally#NotFound": NotFound } }) },
  ];
  const run = (name: string, options?: Parameters<typeof call>[3]) => call(endpoints, "/tally/a", name, options);

  it("will run a call in its folder and reply its value", async () => {
    expect(await run("add", { args: [1, 2] })).toEqual({ status: 200, body: { value: 3 } });
    expect(await run("path")).toEqual({ status: 200, body: { value: "/tally/a" } });
  });

  it("will seat the folders along the call's path", async () => {
    const seats = async (pattern: string[]) => (pattern.length === 2 ? Tally : undefined);

    expect((await run("total", { seats })).body).toEqual({ value: 7 });
  });

  it("will reply an exported error's id, fields and numeric status", async () => {
    expect(await run("limit")).toEqual({ status: 409, body: { error: "/tally#Limit", message: "Over 3", status: 409, limit: 3 } });
    expect(await run("odd")).toEqual({ status: 500, body: { error: "/tally#Odd", message: "Odd", status: "odd" } });
  });

  it("will prefer a known id to an exported one", async () => {
    expect((await run("missing")).body.error).toBe("http:NotFound");
  });

  it("will hide any other error's message outside development", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect((await run("fail")).body).toEqual({ message: "Internal error." });
      expect((await run("raw", { dev: true })).body).toEqual({ message: "Internal error." });
      expect((await run("fail", { dev: true })).body).toMatchObject({ message: "Nope", stack: expect.stringContaining("Error: Nope") });
    } finally {
      warn.mockRestore();
    }
  });
});

describe("unknown error classes", () => {
  it("will warn once per class, in development, of an error class it does not know", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    class Unlisted extends Error {}
    const calls = {
      odd: async () => { throw new Unlisted("Odd"); },
      bug: async () => { throw new TypeError("Bug"); },
    };
    const endpoints: Endpoint[] = [{ pattern: [], exports: async () => ({ calls, classes: {} }) }];

    try {
      expect((await call(endpoints, "/", "odd", { dev: true })).body).toMatchObject({ message: "Odd" });
      await call(endpoints, "/", "odd", { dev: true });
      await call(endpoints, "/", "bug", { dev: true });
      await call(endpoints, "/", "odd");

      expect(warn.mock.calls).toEqual([[`Unlisted is not a known error class, so a build replies "Internal error." for it - export it from a module the client calls, or list it in errors.`]]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("error ids", () => {
  it("will find the nearest exported or known class of an error", async () => {
    class Base extends Error {}
    class Leaf extends Base {}
    class Lost extends NotFound {}
    const calls = {
      leaf: async () => { throw new Leaf(); },
      lost: async () => { throw new Lost("Lost"); },
      plain: async () => { throw new Error(); },
    };
    const endpoints: Endpoint[] = [{ pattern: [], exports: async () => ({ calls, classes: { "#Base": Base } }) }];

    expect((await call(endpoints, "/", "leaf")).body.error).toBe("#Base");
    expect((await call(endpoints, "/", "lost")).body.error).toBe("http:NotFound");
    expect((await call(endpoints, "/", "plain")).body.error).toBeUndefined();
  });
});
