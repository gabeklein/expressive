import { describe, expect, it, vi } from "vitest";
import { Current, HttpError } from "@expressive/rpc";

import { compose, type FolderRefs } from "./fetch";
import type { App } from "./settings";

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
  async folder() {
    return Current.get().params;
  },
  Taken,
};

const shop = { async price() { return 3; } };

const manifest: FolderRefs[] = [
  { pattern: ["tally"], calls: { add: [0, "add"], name: [0, "name"] }, classes: { Taken: [0, "Taken"] } },
  { pattern: ["shop", ":id"], calls: { price: [1, "price"], folder: [0, "folder"] }, classes: {} },
];

const post = (name: string, args: unknown[], at = "/tally") =>
  new Request(`http://localhost${at}`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": name }, body: JSON.stringify(args) });

const json = async (response: Response | Promise<Response>) => (await response).json();

describe("compose", () => {
  it("will answer calls with the env the host passed, else 404", async () => {
    const { fetch } = compose({ target: "fetch" }, [tally, shop], manifest);

    expect(await json(fetch(post("add", [2, 3])))).toEqual({ value: 5 });
    expect(await json(fetch(post("price", [], "/shop/a")))).toEqual({ value: 3 });
    expect(await json(fetch(post("folder", [], "/shop/a%20b")))).toEqual({ value: { id: "a b" } });
    expect(await json(fetch(post("name", []), { NAME: "prod" } as object))).toEqual({ value: "prod" });
    expect(await json(fetch(post("name", [])))).toEqual({});
    expect((await fetch(new Request("http://localhost/"))).status).toBe(404);
  });

  it("will serve pages from env.ASSETS by default, with the shell for a page route", async () => {
    const ASSETS = { fetch: vi.fn(async (request: Request) => new URL(request.url).pathname === "/200.html" ? new Response("shell") : new Response(null, { status: 404 })) };
    let app!: App;
    const { fetch } = compose({ target: "fetch", host: composed => ((app = composed), {}) }, [], [], { patterns: ["/blog/:slug"] });
    const blog = new Request("http://localhost/blog/a");

    expect(await (await fetch(blog, { ASSETS } as object)).text()).toBe("shell");
    expect(await (await app(blog, { env: { ASSETS } as object, assets: { fetch: async () => new Response("own") } })).text()).toBe("own");
    expect((await fetch(blog, { ASSETS: {} } as object)).status).toBe(404);
    expect((await app(blog)).status).toBe(404);
    expect(ASSETS.fetch).toHaveBeenCalledTimes(2);
  });

  it("will reply a thrown error class with its status", async () => {
    const { fetch } = compose({}, [tally, shop], manifest);
    const response = await fetch(post("add", [1, 0]));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Taken", message: "zero" });
  });

  it("will run handle around every request with the host's ctx", async () => {
    const ctx = { waitUntil: vi.fn() };
    const { fetch } = compose({
      async handle({ request, ctx, next }) {
        ctx.waitUntil(Promise.resolve());
        if (new URL(request.url).pathname === "/hello") return new Response("hello");
        return next();
      },
    }, [tally], manifest.slice(0, 1));

    expect(await (await fetch(new Request("http://localhost/hello"), {}, ctx)).text()).toBe("hello");
    expect(await json(fetch(post("add", [1, 2]), {}, ctx))).toEqual({ value: 3 });
    expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
  });

  it("will export host's value, with the default fetch where it has none", async () => {
    const scheduled = () => {};
    const own = { fetch: async () => new Response("own") };
    const host = vi.fn((_app: unknown) => ({ scheduled }));
    const exported = compose({ target: "fetch", host }, [], []) as { fetch(request: Request): Promise<Response>; scheduled?: unknown };

    expect(Object.keys(exported).sort()).toEqual(["fetch", "scheduled"]);
    expect(exported.scheduled).toBe(scheduled);
    expect(typeof host.mock.calls[0][0]).toBe("function");
    expect((await exported.fetch(new Request("http://localhost/"))).status).toBe(404);
    expect(compose({ target: "fetch", host: () => own }, [], []).fetch).toBe(own.fetch);
  });

  it("will keep host's value itself - its prototype, or a class as is", () => {
    class Worker {
      scheduled() {}
    }
    class Entry {}
    const worker = new Worker();
    const exported = compose({ target: "fetch", host: () => worker }, [], []) as Worker & { fetch: unknown };

    expect(exported).toBe(worker);
    expect(typeof exported.fetch).toBe("function");
    expect(compose({ target: "fetch", host: () => Entry }, [], [])).toBe(Entry);
  });

  it("will throw on creation if a ref names no export", () => {
    expect(() => compose({}, [tally], [{ pattern: ["shop"], calls: { price: [1, "price"] }, classes: {} }]))
      .toThrow("/shop has no export price.");
  });

  it("will throw on creation if a folder exports a class that is not an Error", () => {
    expect(() => compose({}, [{ Plain: class Plain {} }], [{ pattern: ["shop"], calls: {}, classes: { Plain: [0, "Plain"] } }]))
      .toThrow("/shop exports Plain, which is neither an async function nor an Error subclass.");
  });
});
