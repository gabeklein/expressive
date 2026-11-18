import { describe, expect, it } from "vitest";

import { get, has, Model } from "@expressive/mvc";

import { Current } from "@expressive/rpc";
import { dispatch, type Seats } from "@expressive/rpc/protocol";

import { connect, listen } from "./connection";
import { install } from "./install";
import { DETACHED, twins, type Endpoint } from "./twin";

const TAB = crypto.randomUUID();

function request(url: string, name: string | undefined, body: string, type = "application/json", extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": type, "x-expressive-connection": TAB, ...extra };
  if (name) headers["x-expressive-call"] = name;
  return { method: "POST", url, headers, body };
}

function fetched({ method, url, headers, body }: ReturnType<typeof request>) {
  return new Request(`http://localhost${url}`, { method, headers, body: method === "GET" ? undefined : body });
}

async function sent(endpoints: Endpoint[], req: ReturnType<typeof request>, dev = false, seats?: Seats) {
  const response = await dispatch(fetched(req), () => endpoints, dev, seats, twins);
  const text = await response.text();

  return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: Object.fromEntries(response.headers) };
}

async function send(endpoints: Endpoint[], req: ReturnType<typeof request>, dev = false, seats?: Seats) {
  const { status, body } = await sent(endpoints, req, dev, seats);
  return { status, body };
}

describe("call dispatch", () => {
  const calls: Record<string, unknown> = {
    add: async (a: number, b: number) => a + b,
    none: async () => {},
    fail: async () => { throw new Error("Nope"); },
  };

  const endpoints: Endpoint[] = [{ pattern: ["tally"], exports: async () => ({ calls, classes: {} }) }];

  it("will reply with a call's value and the tab's frame", async () => {
    expect(await send(endpoints, request("/tally?x=1", "add", "[1, 2]"))).toEqual({ status: 200, body: { value: 3, frame: {} } });
  });

  it("will leave out an undefined value", async () => {
    expect(await send(endpoints, request("/tally", "none", "[]"))).toEqual({ status: 200, body: { frame: {} } });
  });

  it("will reply 400 to a call without a connection id", async () => {
    const bad = { status: 400, body: { message: "Expected an x-expressive-connection id." } };
    const { "x-expressive-connection": _, ...headers } = request("/tally", "add", "[]").headers;

    expect(await send(endpoints, request("/tally", "add", "[]", "application/json", { "x-expressive-connection": "tab" }))).toEqual(bad);
    expect(await send(endpoints, Object.assign(request("/tally", "add", "[]"), { headers }))).toEqual(bad);
  });

  it("will name the connection's epoch on every reply", async () => {
    const first = await sent(endpoints, request("/tally", "add", "[1, 2]"));
    const failed = await sent(endpoints, request("/tally", "fail", "[]"));

    expect(first.headers["x-expressive-epoch"]).toMatch(/^[\w-]{8}$/);
    expect(failed.headers["x-expressive-epoch"]).toBe(first.headers["x-expressive-epoch"]);
  });
});

describe("seat dispatch", () => {
  class Visits extends Model {
    static ttl = 60;
    count = 0;
  }

  class Tally extends Model {
    static ttl = 60;
    total = 0;
    visits = get(Visits);
    async add(by: number) { this.visits.count++; return (this.total += by); }
    async noop() {}
    async slow() { this.total++; await new Promise(resolve => setTimeout(resolve, 5)); }
  }

  const seats: Seats = async pattern => ({ "": Visits, tally: Tally } as Record<string, Model.Type>)[pattern.join("/")] as any;
  const endpoints: Endpoint[] = [
    {
      pattern: [],
      exports: async () => ({ calls: {}, classes: {}, seat: { fields: ["count"], methods: {} } }),
    },
    {
      pattern: ["tally"],
      exports: async () => ({
        calls: { bump: async () => { Tally.get().total++; } },
        classes: {},
        seat: { fields: ["total"], methods: { "default.add": "add", "default.noop": "noop", "default.slow": "slow" } },
      }),
    },
  ];

  function tab() {
    const id = crypto.randomUUID();
    const headers = (extra: Record<string, string | undefined>) =>
      Object.fromEntries(Object.entries({ "x-expressive-connection": id, ...extra }).filter(([, value]) => value)) as Record<string, string>;

    return {
      pull: (twin = "Tally-A", url = "/tally", version?: string) =>
        send(endpoints, request(url, undefined, "[]", "application/json", headers({ "x-expressive-get": "default", "x-expressive-twin": twin, "if-none-match": version })), false, seats),
      call: (name: string, args = "[]", extra: Record<string, string | undefined> = {}) =>
        send(endpoints, request("/tally", name, args, "application/json", headers(extra)), false, seats),
    };
  }

  install();

  it("will reply to a pull with the seat's values and version", async () => {
    const { status, body } = await tab().pull();

    expect(status).toBe(200);
    expect(body).toEqual({ frame: { "Tally-A": { patch: { total: expect.any(Number) }, version: expect.stringMatching(/^[\w-]+:\d+$/) } } });
  });

  it("will reply 400 to a pull or method call without a twin id", async () => {
    const bad = { status: 400, body: { message: "Expected an x-expressive-twin id." } };
    const { pull, call } = tab();

    expect(await pull("")).toEqual(bad);
    expect(await pull("a,b")).toEqual(bad);
    expect(await call("default.noop")).toEqual(bad);
  });

  it("will reply 304 to a pull that holds the current version, else only what changed", async () => {
    const { pull, call } = tab();
    const { version } = (await pull()).body.frame["Tally-A"];

    expect((await pull("Tally-A", "/tally", version)).status).toBe(304);

    await call("default.add", "[1]", { "x-expressive-twin": "Tally-A" });

    expect((await pull("Tally-A", "/tally", version)).body.frame["Tally-A"].patch).toEqual({ total: expect.any(Number) });
  });

  it("will reply to a method call with its value and a frame of every twin it moved", async () => {
    const { pull, call } = tab();
    const tally = (await pull("Tally-A")).body.frame["Tally-A"];
    const visits = (await pull("Visits-B", "/")).body.frame["Visits-B"];
    const { body } = await call("default.add", "[2]", { "x-expressive-twin": "Tally-A", "if-none-match": tally.version });

    expect(body).toEqual({
      value: tally.patch.total + 2,
      frame: {
        "Tally-A": { patch: { total: tally.patch.total + 2 }, version: expect.any(String) },
        "Visits-B": { patch: { count: visits.patch.count + 1 }, version: expect.any(String) },
      },
    });

    const again = await call("default.noop", "[]", { "x-expressive-twin": "Tally-A", "if-none-match": body.frame["Tally-A"].version });
    expect(again.body).toEqual({ frame: {} });
  });

  it("will frame each twin of the same seat on its own", async () => {
    const { pull, call } = tab();
    await pull("Tally-A");
    await pull("Tally-B");

    const { body } = await call("default.add", "[1]", { "x-expressive-twin": "Tally-A" });

    expect(Object.keys(body.frame)).toEqual(["Tally-A", "Tally-B"]);
    expect(body.frame["Tally-B"].patch).toEqual(body.frame["Tally-A"].patch);
  });

  it("will patch a method call with changes the caller missed", async () => {
    const mine = tab();
    const { version } = (await mine.pull()).body.frame["Tally-A"];
    const other = (await tab().call("default.add", "[3]", { "x-expressive-twin": "Tally-Z" })).body;
    const { body } = await mine.call("default.noop", "[]", { "x-expressive-twin": "Tally-A", "if-none-match": version });

    expect(body.frame["Tally-A"]).toEqual({ patch: { total: other.value }, version: expect.any(String) });
  });

  it("will hold a twin a method call names, patching every field without a version", async () => {
    const { body } = await tab().call("default.noop", "[]", { "x-expressive-twin": "Tally-A" });
    expect(body.frame).toEqual({ "Tally-A": { patch: { total: expect.any(Number) }, version: expect.any(String) } });
  });

  it("will frame a plain call's changes to the twins the tab holds", async () => {
    const { pull, call } = tab();
    const { patch: values, version } = (await pull()).body.frame["Tally-A"];

    expect((await call("bump")).body).toEqual({ frame: { "Tally-A": { patch: { total: values.total + 1 }, version: expect.not.stringMatching(version) } } });
    expect((await tab().call("bump")).body).toEqual({ frame: {} });
  });

  it("will announce another tab's changes on the stream, and not the tab's own", async () => {
    const id = crypto.randomUUID();
    const events: [string, any][] = [];
    const mine = { "x-expressive-connection": id, "x-expressive-twin": "Tally-A" };

    listen(connect(id)!, (event, data) => events.push([event, data]));
    await send(endpoints, request("/tally", undefined, "[]", "application/json", { ...mine, "x-expressive-get": "default" }), false, seats);
    await new Promise(resolve => setTimeout(resolve));

    await send(endpoints, request("/tally", "default.slow", "[]", "application/json", mine), false, seats);
    await new Promise(resolve => setTimeout(resolve));
    expect(events.map(([event]) => event)).toEqual(["hello"]);

    await tab().call("default.add", "[1]", { "x-expressive-twin": "Tally-Z" });
    await new Promise(resolve => setTimeout(resolve));
    expect(events.slice(1)).toEqual([["stale", { "Tally-A": ["total"] }]]);
  });

  it("will drop the twins a request releases", async () => {
    const { pull, call } = tab();
    await pull("Tally-A");
    await pull("Visits-B", "/");

    const { body } = await call("default.add", "[1]", { "x-expressive-twin": "Tally-A", "x-expressive-release": "Visits-B,Gone-C" });

    expect(Object.keys(body.frame)).toEqual(["Tally-A"]);
  });

  it("will reply 404 to a pull of a folder without a seat, or naming anything but default", async () => {
    expect((await send([{ pattern: ["x"], exports: async () => ({ calls: {}, classes: {} }) }], request("/x", undefined, "[]", "application/json", { "x-expressive-get": "default" }))).status).toBe(404);
    expect((await send(endpoints, request("/tally", undefined, "[]", "application/json", { "x-expressive-get": "other", "x-expressive-twin": "Tally-A" }), false, seats)).status).toBe(404);
  });

});

describe("pool dispatch", () => {
  class Shop extends Model {
    static ttl = 60;
    name = "shop";

    static key() {
      const { headers } = Current.get().request;

      if (headers.get("x-deny")) throw new Error("Denied");
      return headers.get("x-user") ?? undefined;
    }
  }

  class Cart extends Model {
    protected shop = get(Shop);
    items = 0;
    async add() { this.items++; return this.shop.name; }
    async seat() { return this.get(Shop, false) === undefined ? "none" : "shop"; }
  }

  const POOL = { "/shop#Cart": { Type: Cart, fields: ["items"], methods: { "/shop#Cart.add": "add", "/shop#Cart.seat": "seat" } } };
  const seats: Seats = async pattern => (pattern.join("/") === "shop" ? (Shop as any) : undefined);
  const endpoints: Endpoint[] = [
    { pattern: ["shop"], exports: async () => ({ calls: { end: async () => { Shop.get().set(null); } }, classes: {}, pool: POOL }) },
    { pattern: ["detached"], exports: async () => ({ calls: {}, classes: {}, pool: { "/x#Note": { Type: class Note extends Model { async seat() { return this.get(Shop, false) === undefined ? "none" : "shop"; } }, fields: [], methods: { "/x#Note.seat": "seat" } } } }) },
  ];

  function tab() {
    const id = crypto.randomUUID();
    const as = (url: string, extra: Record<string, string>, name?: string) =>
      send(endpoints, request(url, name, "[]", "application/json", { "x-expressive-connection": id, ...extra }), false, seats);

    return {
      id,
      pull: (twin: string, url = "/shop/42", extra: Record<string, string> = {}) => as(url, { "x-expressive-get": "/shop#Cart", "x-expressive-twin": twin, ...extra }),
      call: (twin: string, method = "/shop#Cart.add", url = "/shop/42", extra: Record<string, string> = {}) => as(url, { "x-expressive-twin": twin, ...extra }, method),
    };
  }

  install();

  it("will build a twin's own instance under the route it names, and catch it up", async () => {
    const { pull, call } = tab();

    expect(await pull("Cart-A")).toEqual({ status: 200, body: { frame: { "Cart-A": { patch: { items: 0 }, version: expect.any(String) } } } });
    expect(await call("Cart-A")).toEqual({ status: 200, body: { value: "shop", frame: { "Cart-A": { patch: { items: 1 }, version: expect.any(String) } } } });
  });

  it("will give each twin its own instance, kept across pulls", async () => {
    const { pull, call } = tab();
    const { version } = (await pull("Cart-A")).body.frame["Cart-A"];
    await pull("Cart-B");

    const { body } = await call("Cart-A");

    expect(Object.keys(body.frame)).toEqual(["Cart-A"]);
    expect((await pull("Cart-A", "/shop/42", { "if-none-match": body.frame["Cart-A"].version })).status).toBe(304);
    expect((await pull("Cart-A", "/shop/42", { "if-none-match": version })).body.frame["Cart-A"].patch).toEqual({ items: 1 });
  });

  it("will run the gates above the route on every request", async () => {
    const { id, pull, call } = tab();
    await pull("Cart-A");

    expect((await pull("Cart-B", "/shop/42", { "x-deny": "1" })).status).toBe(500);
    expect(connect(id)!.twins.has("Cart-B")).toBe(false);

    const denied = request("/shop/42", "/shop#Cart.add", "[]", "application/json", { "x-expressive-connection": id, "x-expressive-twin": "Cart-A", "x-deny": "1" });
    expect((await send(endpoints, denied, false, seats)).status).toBe(500);
    expect((await call("Cart-A")).body).toMatchObject({ value: "shop", frame: { "Cart-A": { patch: { items: 1 } } } });
  });

  it("will build off any route with no seat above it", async () => {
    const { id } = tab();
    const as = (extra: Record<string, string>, name?: string) =>
      send(endpoints, request(DETACHED, name, "[]", "application/json", { "x-expressive-connection": id, "x-expressive-twin": "Note-A", ...extra }), false, seats);

    expect((await as({ "x-expressive-get": "/x#Note" })).status).toBe(200);
    expect((await as({}, "/x#Note.seat")).body.value).toBe("none");
  });

  it("will refuse a method for a twin it does not hold, or holds as something else", async () => {
    const { pull, call } = tab();
    await pull("Cart-A");

    expect((await call("Cart-B")).status).toBe(404);

    const mine = tab();
    await mine.pull("Cart-A");
    const other = { "x-expressive-connection": mine.id, "x-expressive-twin": "Cart-A" };

    expect((await send(endpoints, request("/shop/42", undefined, "[]", "application/json", { ...other, "x-expressive-get": "/x#Note" }), false, seats)).status).toBe(404);
    expect((await send(endpoints, request("/tally", "default.add", "[]", "application/json", other), false, seats)).status).toBe(404);
  });

  it("will refuse a twin whose walk now lands in another context, destroying its instance, and build afresh after", async () => {
    const { id, pull, call } = tab();
    const a = { "x-user": "a" };
    const b = { "x-user": "b" };

    await pull("Cart-A", "/shop/42", a);
    await call("Cart-A", "/shop#Cart.add", "/shop/42", a);
    const { instance } = connect(id)!.twins.get("Cart-A")!;

    expect(await call("Cart-A", "/shop#Cart.add", "/shop/42", b)).toEqual({ status: 409, body: { message: "This twin's context was replaced - its instance is gone." } });
    expect(instance.get(null)).toBe(true);
    expect((await pull("Cart-A", "/shop/42", b)).body.frame["Cart-A"].patch).toEqual({ items: 0 });
  });

  it("will refuse a twin whose seat ended", async () => {
    const { pull, call } = tab();
    const c = { "x-user": "c" };

    await pull("Cart-A", "/shop/42", c);
    expect((await call("end", "end", "/shop", c)).status).toBe(200);
    expect((await call("Cart-A", "/shop#Cart.add", "/shop/42", c)).status).toBe(409);
  });

  it("will destroy a pooled instance its twin releases", async () => {
    const { id, pull } = tab();
    await pull("Cart-A");
    const { instance } = connect(id)!.twins.get("Cart-A")!;

    await send(endpoints, request("/shop/42", undefined, "[]", "application/json", { "x-expressive-connection": id, "x-expressive-get": "/shop#Cart", "x-expressive-twin": "Cart-B", "x-expressive-release": "Cart-A" }), false, seats);

    expect(instance.get(null)).toBe(true);
  });
});

describe("child dispatch", () => {
  class Line extends Model {
    qty = 1;
    async bump(by: number) { return (this.qty += by); }
  }

  class Order extends Model {
    static ttl = 60;
    line?: Line = new Line();
    async drop() { this.line = undefined; }
  }

  class Basket extends Model {
    line?: Line = undefined;
    async fill() { this.line = new Line(); }
  }

  const SHAPE = { fields: ["line"], children: { line: { fields: ["qty"] } } };
  const seats: Seats = async pattern => (pattern.join("/") === "order" ? (Order as any) : undefined);
  const endpoints: Endpoint[] = [
    {
      pattern: ["order"],
      exports: async () => ({
        calls: {},
        classes: {},
        seat: { ...SHAPE, methods: { "default.drop": "drop", "default.line.bump": "line.bump" } },
        pool: { "/order#Basket": { Type: Basket, ...SHAPE, methods: { "/order#Basket.fill": "fill", "/order#Basket.line.bump": "line.bump" } } },
      }),
    },
  ];

  function tab() {
    const id = crypto.randomUUID();

    return (name: string | undefined, extra: Record<string, string>, args = "[]") =>
      send(endpoints, request("/order", name, args, "application/json", { "x-expressive-connection": id, ...extra }), true, seats);
  }

  install();

  it("will call a seat's child method by its path, framing the child under its own key", async () => {
    const as = tab();
    const pulled = await as(undefined, { "x-expressive-get": "default", "x-expressive-twin": "Order-A" });

    expect(pulled.body.frame).toEqual({
      "Order-A": { patch: { line: { $child: expect.any(String) } }, version: expect.any(String) },
      "Order-A.line": { patch: { qty: 1 }, version: expect.any(String) },
    });

    const { body } = await as("default.line.bump", { "x-expressive-twin": "Order-A", "if-none-match": pulled.body.frame["Order-A"].version }, "[2]");

    expect(body).toEqual({ value: 3, frame: { "Order-A.line": { patch: { qty: 3 }, version: expect.any(String) } } });
  });

  it("will call a pooled twin's child method by its path", async () => {
    const as = tab();
    const twin = { "x-expressive-twin": "Basket-A" };

    await as(undefined, { "x-expressive-get": "/order#Basket", ...twin });
    expect((await as("/order#Basket.fill", twin)).body.frame["Basket-A.line"]).toEqual({ patch: { qty: 1 }, version: expect.any(String) });
    expect((await as("/order#Basket.line.bump", twin, "[1]")).body.value).toBe(2);
  });

  it("will fail a child method whose child is not set", async () => {
    const as = tab();
    const twin = { "x-expressive-twin": "Order-A" };

    await as("default.drop", twin);

    expect(await as("default.line.bump", twin, "[1]")).toEqual({ status: 500, body: { message: expect.stringMatching(/^line is not set on Order-/), stack: expect.any(String) } });
  });
});

describe("collection dispatch", () => {
  class Render extends Model {
    id = "";
    progress = 0;
    protected studio = get(Studio);
    async step(by: number) { return (this.progress += by); }
  }

  class Studio extends Model {
    static ttl = 60;
    jobs = has(Render, "id");

    static key() {
      return Current.get().request.headers.get("x-user") ?? undefined;
    }

    async start(...ids: string[]) { ids.forEach(id => this.jobs.add(id)); }
    async stop(id: string) { this.jobs.get(job => job.id === id)!.set(null); }
  }

  const SHAPE = { fields: ["jobs"], children: { jobs: { fields: ["id", "progress"], many: true as const } } };
  const seats: Seats = async pattern => (pattern.join("/") === "studio" ? (Studio as any) : undefined);
  const endpoints: Endpoint[] = [
    {
      pattern: ["studio"],
      exports: async () => ({
        calls: {},
        classes: {},
        seat: { ...SHAPE, methods: { "default.start": "start", "default.stop": "stop", "default.jobs.step": "jobs.step" } },
      }),
    },
  ];

  function tab(user = crypto.randomUUID(), id = crypto.randomUUID()) {
    let version: string | undefined;

    const as = async (name: string | undefined, extra: Record<string, string> = {}, args = "[]") => {
      const headers = { "x-expressive-connection": id, "x-user": user, "x-expressive-twin": "Studio-A", ...(version ? { "if-none-match": version } : {}), ...extra };
      const reply = await send(endpoints, request("/studio", name, args, "application/json", headers), true, seats);

      version = reply.body?.frame?.["Studio-A"]?.version ?? version;
      return reply;
    };

    return { user, id, as, pull: () => as(undefined, { "x-expressive-get": "default" }) };
  }

  install();

  it("will frame each member under its own id, and membership as the owner's id list", async () => {
    const { as, pull } = tab();

    await as("default.start", {}, '["a"]');
    const { body: started } = await as("default.start", {}, '["b"]');
    const { body: pulled } = await tab().pull();
    const [a, b] = started.frame["Studio-A"].patch.jobs.$items;

    expect(started.frame).toEqual({
      "Studio-A": { patch: { jobs: { $items: [a, b] } }, version: expect.any(String) },
      [`Studio-A.jobs.${b}`]: { patch: { id: "b", progress: 0 }, version: expect.stringMatching(new RegExp(`^${b}:`)) },
    });
    expect(pulled.frame).toEqual({ "Studio-A": { patch: { jobs: { $items: [] } }, version: expect.any(String) } });
    expect((await pull()).status).toBe(304);
  });

  it("will patch one member alone, keeping its id", async () => {
    const { as } = tab();
    const { body } = await as("default.start", {}, '["a", "b"]');
    const [a] = body.frame["Studio-A"].patch.jobs.$items;

    expect(await as("default.jobs.step", { "x-expressive-items": a }, "[5]")).toEqual({
      status: 200,
      body: { value: 5, frame: { [`Studio-A.jobs.${a}`]: { patch: { progress: 5 }, version: `${a}:1` } } },
    });
  });

  it("will send only the id list when a member leaves", async () => {
    const { as } = tab();
    const { body } = await as("default.start", {}, '["a", "b"]');
    const [, b] = body.frame["Studio-A"].patch.jobs.$items;

    expect((await as("default.stop", {}, '["a"]')).body.frame).toEqual({ "Studio-A": { patch: { jobs: { $items: [b] } }, version: expect.any(String) } });
  });

  it("will announce a member's change on the stream under its own key", async () => {
    const mine = tab();
    const other = tab(mine.user);
    const events: [string, any][] = [];
    const { body } = await mine.as("default.start", {}, '["a"]');
    const [a] = body.frame["Studio-A"].patch.jobs.$items;

    listen(connect(mine.id)!, (event, data) => events.push([event, data]));
    await other.pull();
    await other.as("default.jobs.step", { "x-expressive-items": a }, "[1]");
    await new Promise(resolve => setTimeout(resolve));
    await other.as("default.start", {}, '["c"]');
    await new Promise(resolve => setTimeout(resolve));

    expect(events.slice(1)).toEqual([
      ["stale", { [`Studio-A.jobs.${a}`]: ["progress"] }],
      ["stale", { "Studio-A": ["jobs"], [`Studio-A.jobs.${a}`]: ["progress"] }],
    ]);
  });

  it("will fail a member method whose member is gone", async () => {
    expect(await tab().as("default.jobs.step", { "x-expressive-items": "nope" }, "[1]")).toEqual({
      status: 500,
      body: { message: expect.stringMatching(/^jobs is not set on Studio-/), stack: expect.any(String) },
    });
  });
});

describe("open dispatch", () => {
  const ALL = new Map<string, Model>();

  class Render extends Model {
    id = "";
    progress = 0;
    async step() { return ++this.progress; }

    static open(id: string) {
      return Studio.get().jobs.get(job => job.id === id);
    }
  }

  class Leak extends Model {
    static open(id: string) {
      return ALL.get(id);
    }
  }

  class Studio extends Model {
    static ttl = 60;
    jobs = has(Render, "id");

    static key() {
      return Current.get().request.headers.get("x-user") ?? undefined;
    }

    async start(id: string) { ALL.set(id, this.jobs.add(id)); }
    async finish(id: string) { ALL.get(id)!.set(null); }
  }

  const POOL = {
    "/studio#Render": { Type: Render, fields: ["id", "progress"], methods: { "/studio#Render.step": "step" } },
    "/studio#Leak": { Type: Leak, fields: [], methods: {} },
    "/studio#Cart": { Type: class Cart extends Model {}, fields: [], methods: {} },
  };
  const seats: Seats = async pattern => (pattern.join("/") === "studio" ? (Studio as any) : undefined);
  const endpoints: Endpoint[] = [
    { pattern: ["studio"], exports: async () => ({ calls: {}, classes: {}, seat: { fields: [], methods: { "default.start": "start", "default.finish": "finish" } }, pool: POOL }) },
  ];

  function tab(user: string) {
    const id = crypto.randomUUID();
    const as = (extra: Record<string, string>, name?: string) =>
      send(endpoints, request("/studio", name, name ? `["${extra.arg ?? ""}"]` : "[]", "application/json", { "x-expressive-connection": id, "x-user": user, ...extra }), false, seats);

    return {
      id,
      start: (job: string) => as({ "x-expressive-twin": "Studio-A", arg: job }, "default.start"),
      finish: (job: string) => as({ "x-expressive-twin": "Studio-A", arg: job }, "default.finish"),
      open: (twin: string, key: string, Type = "Render", extra: Record<string, string> = {}) =>
        as({ "x-expressive-get": `/studio#${Type}`, "x-expressive-twin": twin, "x-expressive-key": encodeURIComponent(key), ...extra }),
      step: (twin: string, extra: Record<string, string> = {}) => as({ "x-expressive-twin": twin, ...extra }, "/studio#Render.step"),
    };
  }

  install();

  it("will hold the instance open() returns, call it in place, and not destroy it on release", async () => {
    const mine = tab("u1");
    await mine.start("r/1");

    expect(await mine.open("Render-A", "r/1")).toEqual({ status: 200, body: { frame: { "Render-A": { patch: { id: "r/1", progress: 0 }, version: expect.any(String) } } } });
    expect((await mine.step("Render-A")).body.value).toBe(1);
    expect(connect(mine.id)!.twins.get("Render-A")!.instance).toBe(ALL.get("r/1"));

    await mine.open("Render-B", "r/1", "Render", { "x-expressive-release": "Render-A" });
    expect(ALL.get("r/1")!.get(null)).toBe(false);
    expect((await mine.step("Render-B")).body.value).toBe(2);
  });

  it("will reply 404 when open() finds nothing, or the class has no open()", async () => {
    const mine = tab("u2");

    expect(await mine.open("Render-A", "none")).toEqual({ status: 404, body: { message: "Not found." } });
    expect((await mine.open("Cart-A", "x", "Cart")).status).toBe(404);
    expect(connect(mine.id)!.twins.has("Render-A")).toBe(false);
  });

  it("will refuse an instance no seat of the request owns", async () => {
    await tab("u3").start("r3");

    expect((await tab("u4").open("Leak-A", "r3", "Leak")).status).toBe(404);
    expect((await tab("u3").open("Leak-A", "r3", "Leak")).status).toBe(200);
  });

  it("will refuse a held twin once its request reaches another seat, or its instance ends", async () => {
    const mine = tab("u5");
    await mine.start("r5");
    await mine.open("Leak-A", "r5", "Leak");
    await mine.open("Render-A", "r5");

    expect((await mine.step("Render-A", { "x-user": "u6" })).status).toBe(409);

    await mine.finish("r5");
    expect((await mine.open("Leak-A", "r5", "Leak")).status).toBe(409);
  });

  it("will reply 400 to a key that is not URI-encoded", async () => {
    expect((await tab("u7").open("Render-A", "x", "Render", { "x-expressive-key": "%" })).status).toBe(400);
  });
});
