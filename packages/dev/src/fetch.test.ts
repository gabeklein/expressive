import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { Current, HttpError } from "@expressive/rpc";

import { fetchHandler, type FolderRefs } from "./fetch";

class Taken extends HttpError {
  status = 409;
}

const tally = {
  async add(a: number, b: number) {
    if (!b) throw new Taken("zero");
    return a + b;
  },
  async name() {
    return (Current.get().env as { NAME?: string }).NAME;
  },
  Taken,
};

const shop = { async price() { return 3; } };

const manifest: FolderRefs[] = [
  { pattern: ["tally"], calls: { add: [0, "add"], name: [0, "name"] }, classes: { Taken: [0, "Taken"] } },
  { pattern: ["shop"], calls: { price: [1, "price"] }, classes: {} },
];

const post = (name: string, args: unknown[], at = "/tally") =>
  new Request(`http://localhost${at}`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name }, body: JSON.stringify(args) });

const json = async (response: Response | Promise<Response>) => (await response).json();

describe("fetchHandler", () => {
  it("will answer calls with the env the host passed", async () => {
    const { fetch } = fetchHandler({ target: "fetch" }, [tally, shop], manifest);

    expect(await json(fetch(post("add", [2, 3])))).toEqual({ value: 5 });
    expect(await json(fetch(post("price", [], "/shop")))).toEqual({ value: 3 });
    expect(await json(fetch(post("name", []), { NAME: "prod" } as object))).toEqual({ value: "prod" });
    expect(await json(fetch(post("name", [])))).toEqual({});
  });

  it("will reply a thrown error class with its status", async () => {
    const { fetch } = fetchHandler({}, [tally, shop], manifest);
    const response = await fetch(post("add", [1, 0]));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Taken", message: "zero" });
  });

  it("will run the app's fetch in the request's scope, else reply 404 - also its next", async () => {
    const ctx = { waitUntil: vi.fn() };
    const { fetch } = fetchHandler({
      async fetch(request, env, ctx, next) {
        ctx.waitUntil(Promise.resolve());
        if (new URL(request.url).pathname === "/next") return next();
        if (new URL(request.url).pathname === "/hello") return Response.json({ env, path: Current.get().url.pathname });
      },
    }, [], []);

    expect(await json(fetch(new Request("http://localhost/hello"), { NAME: "prod" } as object, ctx))).toEqual({ env: { NAME: "prod" }, path: "/hello" });
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect((await fetch(new Request("http://localhost/missing"), {}, ctx)).status).toBe(404);
    expect((await fetch(new Request("http://localhost/next"), {}, ctx)).status).toBe(404);
  });

  it("will run calls and the app's fetch inside around", async () => {
    const store = new AsyncLocalStorage<string>();
    const where = async () => store.getStore();
    const { fetch } = fetchHandler({
      around: (next, { request, env }) => store.run(`${new URL(request.url).pathname} ${(env as { NAME: string }).NAME}`, next),
      fetch: async () => Response.json(await where()),
    }, [{ where }], [{ pattern: ["tally"], calls: { where: [0, "where"] }, classes: {} }]);
    const env = { NAME: "prod" } as object;

    expect(await json(fetch(post("where", []), env))).toEqual({ value: "/tally prod" });
    expect(await json(fetch(new Request("http://localhost/hello"), env))).toBe("/hello prod");
  });

  it("will reply what around throws as the call's error", async () => {
    const { fetch } = fetchHandler({
      around(next, { request }) {
        if (request.headers.has("x-fail")) throw new Error("no session");
        throw new Taken("no seat");
      },
    }, [tally, shop], manifest);
    const failed = post("add", [1, 1]);
    failed.headers.set("x-fail", "1");
    const refused = await fetch(failed);
    const taken = await fetch(post("add", [1, 1]));

    expect([refused.status, await refused.json()]).toEqual([500, { message: "Internal error." }]);
    expect([taken.status, (await taken.json()).error]).toEqual([409, "Taken"]);
  });

  it("will log a rejected waitUntil where the host passes no ctx", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const late = new Error("late");
    const { fetch } = fetchHandler({ fetch: async (_, __, ctx) => (ctx.waitUntil(Promise.reject(late)), new Response("ok")) }, [], []);

    try {
      expect(await (await fetch(new Request("http://localhost/"))).text()).toBe("ok");
      await vi.waitFor(() => expect(error).toHaveBeenCalledWith("waitUntil:", late));
    } finally {
      error.mockRestore();
    }
  });

  it("will keep the config's other members, but not its settings", () => {
    const scheduled = () => {};
    const handler = fetchHandler({ target: "fetch", port: 1, remote: { opaque: false }, fetch: async () => undefined, around: next => next(), scheduled }, [], []);

    expect(Object.keys(handler).sort()).toEqual(["fetch", "scheduled"]);
    expect(handler.scheduled).toBe(scheduled);
  });

  it("will run each gate above a call before it, refusing by a throw", async () => {
    const seen: string[] = [];
    const site = () => void seen.push("site");
    const deny = () => {
      seen.push("shop");
      if (Current.get().request.headers.has("x-deny")) throw new Taken("Sign in");
    };
    const { fetch } = fetchHandler({}, [tally, shop, { default: site }, { default: deny }], manifest, [
      { pattern: [], gate: [2, "default"] },
      { pattern: ["shop"], gate: [3, "default"] },
    ]);
    const denied = post("price", [], "/shop");
    denied.headers.set("x-deny", "1");

    expect(await json(fetch(post("add", [2, 3])))).toEqual({ value: 5 });
    expect(await json(fetch(post("price", [], "/shop")))).toEqual({ value: 3 });
    expect(seen.splice(0)).toEqual(["site", "site", "shop"]);

    const refused = await fetch(denied);
    expect([refused.status, await refused.json()]).toEqual([409, expect.objectContaining({ error: "Taken", message: "Sign in" })]);
  });

  it("will throw on creation if a gate ref names no export", () => {
    expect(() => fetchHandler({}, [tally], [], [{ pattern: ["shop"], gate: [1, "default"] }])).toThrow("/shop has no export default.");
  });

  it("will throw on creation if a ref names no export", () => {
    expect(() => fetchHandler({}, [tally], [{ pattern: ["shop"], calls: { price: [1, "price"] }, classes: {} }]))
      .toThrow("/shop has no export price.");
  });

  it("will throw on creation if a folder exports a class that is not an Error", () => {
    expect(() => fetchHandler({}, [{ Plain: class Plain {} }], [{ pattern: ["shop"], calls: {}, classes: { Plain: [0, "Plain"] } }]))
      .toThrow("/shop exports Plain, which is neither an async function nor an Error subclass.");
  });
});
