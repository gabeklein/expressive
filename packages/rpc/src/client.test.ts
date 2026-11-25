// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/" }

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Endpoint } from "./call";
import { handler } from "./http/call";
import * as shared from "./client";

const { client } = shared;

interface Reply {
  body: unknown;
  status?: number;
  epoch?: string;
}

let call: ReturnType<typeof client>["call"];
let define: ReturnType<typeof client>["define"];

beforeEach(() => {
  ({ call, define } = client());
  history.replaceState(null, "", "/tally");
});

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

function serve(...replies: Reply[]) {
  const fetch = vi.fn(async (_path: unknown, _init?: RequestInit) => {
    const { body, status = 200, epoch = "e1" } = replies.shift()!;

    return new Response(JSON.stringify(body), { status, headers: { "x-expressive-epoch": epoch, "content-type": "application/json; codec=expressive" } });
  });

  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("call", () => {
  it("will POST the arguments to its path with no connection id, and resolve the value alone", async () => {
    history.replaceState(null, "", "/blog/hello/edit?draft=1");
    const fetch = serve({ body: { value: 3, frame: { "Tally-A": { patch: { total: 4 }, version: "g:2" } } } });

    expect(await call("/admin", "users:add", [1, 2])).toBe(3);
    expect(fetch).toHaveBeenCalledWith("/admin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-expressive-call": "users:add" },
      body: "[1,2]",
    });
  });

  it("will throw a failed call's message", async () => {
    serve({ body: { message: "Internal error." }, status: 500, epoch: "" });
    await expect(call("/", "fail", [])).rejects.toThrow("Internal error.");
  });

  it("will rebuild an exported error class with its fields", async () => {
    const Limit = define("/tally#Limit", "Limit");
    serve({ body: { error: "/tally#Limit", message: "Over 3", status: 409, limit: 3 }, status: 409 });

    const error = (await call("/", "add", []).catch((e: Error) => e)) as Error;

    expect(error).toBeInstanceOf(Limit);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "Limit", message: "Over 3", status: 409, limit: 3 });
  });

  it("will throw a plain Error for a class this client never imported", async () => {
    serve({ body: { error: "/other#Nope", message: "No", status: 409 }, status: 409 });

    const error = (await call("/", "add", []).catch((e: Error) => e)) as Error;

    expect(error.constructor).toBe(Error);
    expect(error).toMatchObject({ message: "No", status: 409 });
  });
});

describe("gate check", () => {
  it("will POST an unnamed get to the path, resolving nothing once the gates pass", async () => {
    const fetch = serve({ body: {} });

    expect(await call("/shop/1", "", [])).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/shop/1", expect.objectContaining({ headers: { "content-type": "application/json", "x-expressive-get": "" } }));
  });

  it("will throw a refusal, rebuilt as a call's error", async () => {
    const Limit = define("/tally#Limit", "Limit");
    serve({ body: { error: "/tally#Limit", message: "Over 3", status: 409 }, status: 409 });

    await expect(call("/", "", [])).rejects.toBeInstanceOf(Limit);
  });

  it("will pass a reply that isn't the codec's, and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Gated.", { status: 401 })));
    expect(await call("/", "", [])).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await call("/", "", [])).toBeUndefined();
  });
});

describe("api", () => {
  it("will call by place in the tree - the path its nodes, the name its last", async () => {
    const fetch = serve({ body: { value: 1 } }, { body: { value: 2 } });
    const { api } = client<{ ping(): Promise<string>; admin: { users: { ban(id: number): Promise<void> } } }>();

    expect(await api.admin.users.ban(7)).toBe(1);
    expect(fetch).toHaveBeenLastCalledWith("/admin/users", expect.objectContaining({ headers: expect.objectContaining({ "x-expressive-call": "ban" }), body: "[7]" }));

    expect(await api.ping()).toBe(2);
    expect(fetch).toHaveBeenLastCalledWith("/", expect.anything());
  });

  it("will give one node per name, to keep a call stable as a callback", () => {
    const { api } = client();

    expect(api.claim.search).toBe(api.claim.search);
    expect(api.claim).toBe(api.claim);
    expect(api.with({}).claim).not.toBe(api.claim);
  });

  it("will not be a thenable or a symbol's holder, and its root is not a call", async () => {
    const { api } = client();

    expect(api.then).toBeUndefined();
    expect(api[Symbol.iterator as never]).toBeUndefined();
    expect(await Promise.resolve(api.claim)).toBe(api.claim);
    expect(() => api()).toThrow("The client's root is not a call - name one: api.list().");
  });

  it("will abort the calls under a node when its signal does", async () => {
    vi.stubGlobal("fetch", vi.fn((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)))));
    const { api } = client();
    const control = new AbortController();
    const pending = api.with({ signal: control.signal }).claim.search();

    control.abort(new Error("Stopped."));

    await expect(pending).rejects.toThrow("Stopped.");
  });

  it("will fail the calls under a node after its timeout, nested options extending the outer", async () => {
    const fetch = vi.fn((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))));
    vi.stubGlobal("fetch", fetch);
    const { api } = client();
    const control = new AbortController();
    const pending = api.with({ signal: control.signal }).claim.with({ timeout: 5 }).search();

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(control.signal.aborted).toBe(false);

    serve({ body: { value: 1 } });
    expect(await api.claim.search()).toBe(1);
  });
});

describe("errors", () => {
  class Duplicate extends Error {
    constructor(message: string, public existing = "") { super(message); }
  }

  it("will rebuild an error as the class given for its id, fields and all", async () => {
    serve({ body: { error: "Duplicate", message: "Taken", status: 409, existing: "a" }, status: 409 });
    const { call } = client({ errors: { Duplicate } });

    const error = await call("/", "add", []).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Duplicate);
    expect(error).toMatchObject({ message: "Taken", existing: "a", status: 409 });
  });

  it("will take error classes configured later, and define a given one as itself", async () => {
    serve({ body: { error: "Duplicate", message: "Taken" }, status: 409 });
    const rpc = client();

    rpc.configure({ errors: { Duplicate } });

    expect(rpc.define("Duplicate", "Duplicate")).toBe(Duplicate);
    expect(await rpc.call("/", "add", []).catch((e: Error) => e)).toBeInstanceOf(Duplicate);
  });
});

describe("pathOf", () => {
  const { pathOf } = client();

  it("will fill a pattern's params from the location", () => {
    history.replaceState(null, "", "/blog/hello/edit?draft=1");
    expect(pathOf(["blog", ":slug"], "add")).toBe("/blog/hello");
  });

  it("will fill a catch-all with the rest of the location", () => {
    expect(pathOf(["docs", "*"], "none", "/docs/a/b")).toBe("/docs/a/b");
  });

  it("will throw if called from outside the pattern's folder", () => {
    expect(() => pathOf(["blog", ":slug"], "add", "/about")).toThrow("add() belongs to /blog/:slug and cannot be called from /about.");
    expect(() => pathOf(["blog"], "add", "/about")).toThrow("belongs to /blog");
  });
});

describe("send", () => {
  it("will resolve nothing for a reply of not modified", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetch);

    expect(await client().send("/tally", {}, [])).toBeUndefined();
  });

  it("will reject a reply that isn't the codec's with an HttpError carrying its status, plain JSON and a 2xx included", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Gated.", { status: 200 })));
    const text = await client().send("/tally", {}, []).catch((e: Error) => e);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true }, { status: 201 })));
    const json = await client().send("/tally", {}, []).catch((e: Error) => e);

    expect(text).toBeInstanceOf(shared.HttpError);
    expect(text).toMatchObject({ message: "Gated.", status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 502 })));
    const bare = await client().send("/tally", {}, []).catch((e: Error) => e);

    expect(json).toMatchObject({ message: '{"ok":true}', status: 201 });
    expect(bare).toMatchObject({ message: "", status: 502 });
  });
});

describe("configure", () => {
  const add = vi.fn(async (a: number, b: number) => a + b);
  const endpoints: Endpoint[] = [{ pattern: ["tally"], exports: async () => ({ calls: { add }, classes: {} }) }];
  const inProcess = handler(endpoints);
  const transport = vi.fn(async (request: Request) => (await inProcess(request))!);

  beforeEach(() => {
    add.mockClear();
    transport.mockClear();
  });

  it("will prefix each call's path with a base", async () => {
    const fetch = serve({ body: { value: 3 } }, { body: { value: 4 } });
    const rpc = client({ base: "https://api.example.com" });

    expect(await rpc.call("/tally", "add", [1, 2])).toBe(3);
    expect(fetch).toHaveBeenLastCalledWith("https://api.example.com/tally", expect.objectContaining({ method: "POST" }));

    rpc.configure({ base: "https://other.example.com/v1" });

    expect(await rpc.call("/tally", "add", [2, 2])).toBe(4);
    expect(fetch).toHaveBeenLastCalledWith("https://other.example.com/v1/tally", expect.anything());
  });

  it("will send a call through a transport instead of fetch, in process", async () => {
    const fetch = serve();
    const rpc = client({ transport, headers: () => ({ authorization: "Bearer a" }) });

    expect(await rpc.call("/tally", "add", [1, 2])).toBe(3);
    expect(add).toHaveBeenCalledWith(1, 2);
    expect(fetch).not.toHaveBeenCalled();

    const [request] = transport.mock.calls[0];

    expect(request.url).toBe("http://localhost/tally");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer a");
    expect(request.headers.get("x-expressive-call")).toBe("add");
  });

  it("will keep earlier options when configured again", async () => {
    const rpc = client({ base: "http://rpc.test" });
    let token = "a";

    rpc.configure({ transport });
    rpc.configure({ headers: () => ({ authorization: `Bearer ${token}` }) });

    await rpc.call("/tally", "add", [1, 2]);
    token = "b";
    await rpc.call("/tally", "add", [1, 2]);

    const sent = transport.mock.calls.map(([request]) => [request.url, request.headers.get("authorization")]);

    expect(sent).toEqual([["http://rpc.test/tally", "Bearer a"], ["http://rpc.test/tally", "Bearer b"]]);
  });

  it("will throw if a relative base has no page location to resolve against", async () => {
    const fetch = serve();
    vi.stubGlobal("location", undefined);

    await expect(client({ base: "/api" }).call("/tally", "add", [])).rejects.toThrow(
      'Cannot send to /api/tally - a relative base needs a page location to resolve against. Pass an absolute base: configure({ base: "https://api.example.com" }).',
    );
    await expect(client({ transport }).call("/tally", "add", [])).rejects.toThrow("Pass an absolute base");
    expect(fetch).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("will send through a transport to an absolute base without a page location", async () => {
    vi.stubGlobal("location", undefined);

    expect(await client({ base: "http://rpc.test", transport }).call("/tally", "add", [2, 2])).toBe(4);
    expect(transport.mock.calls[0][0].url).toBe("http://rpc.test/tally");
  });

  it("will configure the shared client its exports call through", async () => {
    shared.configure({ transport });
    const Limit = shared.define("/tally#Limit", "Limit");

    expect(await shared.call("/tally", "add", [2, 3])).toBe(5);
    expect(transport).toHaveBeenCalledTimes(1);

    shared.configure({ transport: undefined });
    serve({ body: { error: "/tally#Limit", message: "Over" }, status: 409 });

    await expect(shared.call("/tally", "add", [])).rejects.toBeInstanceOf(Limit);
  });
});

describe("values", () => {
  it("will carry what JSON loses both ways through a call, in process", async () => {
    const later = vi.fn(async (when: Date, step: bigint | undefined, tags: Set<string>) => ({ at: new Date(when.getTime() + Number(step ?? 1000n)), tags: [...tags], step }));
    const endpoints: Endpoint[] = [{ pattern: ["clock"], exports: async () => ({ calls: { later }, classes: {} }) }];
    const inProcess = handler(endpoints);
    const rpc = client({ base: "http://localhost", transport: async request => (await inProcess(request))! });
    const when = new Date("2026-11-08T12:00:00.000Z");

    expect(await rpc.call("/clock", "later", [when, undefined, new Set(["a"])])).toEqual({ at: new Date("2026-11-08T12:00:01.000Z"), tags: ["a"] });
    expect(later).toHaveBeenCalledWith(when, undefined, new Set(["a"]));
  });

  it("will carry a thrown error's fields the same way", async () => {
    class Late extends Error {
      due = new Date("2026-11-08T12:00:00.000Z");
      left = 3n;
    }

    const check = async () => {
      throw new Late("Overdue.");
    };
    const endpoints: Endpoint[] = [{ pattern: ["clock"], exports: async () => ({ calls: { check }, classes: { "clock#Late": Late } }) }];
    const inProcess = handler(endpoints);
    const rpc = client({ base: "http://localhost", transport: async request => (await inProcess(request))! });
    const Remote = rpc.define("clock#Late", "Late");
    const error = await rpc.call("/clock", "check", []).catch(error => error);

    expect(error).toBeInstanceOf(Remote);
    expect(error).toMatchObject({ message: "Overdue.", due: new Date("2026-11-08T12:00:00.000Z"), left: 3n });
  });
});
