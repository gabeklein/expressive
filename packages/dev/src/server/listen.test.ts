import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { Agent, request } from "node:http";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HandleArgs } from "../settings";
import { fileResponse, listen } from "./listen";

describe("static files", () => {
  const dir = mkdtempSync(join(tmpdir(), "client-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html></html>");
  writeFileSync(join(dir, "assets", "app.js"), "1");

  it("sends a file under the directory with its type, opened on first read", async () => {
    writeFileSync(join(dir, "late.txt"), "1");

    const res = fileResponse(dir, "/late.txt")!;
    await new Promise(done => setTimeout(done, 20));
    unlinkSync(join(dir, "late.txt"));

    expect(res.headers.get("content-type")).toContain("text/plain");
    await expect(res.text()).rejects.toThrow();
  });

  it("will cancel a file's body whether or not it was read", async () => {
    await fileResponse(dir, "/index.html")!.body!.cancel();

    const reader = fileResponse(dir, "/index.html")!.body!.getReader();
    await reader.read();
    await reader.cancel();
  });

  it("will not serve a missing file, a directory, or a path outside the directory", () => {
    expect(fileResponse(dir, "/nope.js")).toBeUndefined();
    expect(fileResponse(dir, "/assets")).toBeUndefined();
    expect(fileResponse(dir, "/../" + dir.split("/").pop() + "/index.html")).toBeUndefined();
    expect(fileResponse(join(dir, "assets"), "/../index.html")).toBeUndefined();
    expect(fileResponse(dir, "/%E0%A4%A")).toBeUndefined();
  });
});

describe("listen", () => {
  it("will reply 400 to a request it cannot read, and keep serving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "client-"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const server = listen({ settings: { port: 0 }, client: dir });
    await new Promise(done => server.once("listening", done));

    const { port } = server.address() as AddressInfo;
    const raw = (head: string) => new Promise<string>(done => {
      const socket = connect({ port }, () => void socket.write(`${head}\r\nConnection: close\r\n\r\n`));
      let out = "";
      socket.on("data", chunk => (out += chunk));
      socket.on("close", () => done(out.split("\r\n")[0]));
    });

    expect(await raw("GET / HTTP/1.1\r\nHost: a:b")).toBe("HTTP/1.1 400 Bad Request");
    expect(await raw("GET http://[ HTTP/1.1\r\nHost: x")).toBe("HTTP/1.1 400 Bad Request");
    expect(await raw("GET / HTTP/1.1\r\nHost: x")).toBe("HTTP/1.1 200 OK");

    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const send = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => new Promise<number>((done, fail) => {
      const req = request({ port, method, path, agent, headers, timeout: 2000 }, res => (res.resume(), done(res.statusCode!)));
      req.on("timeout", () => fail(new Error("timed out")));
      req.end(body);
    });

    const call = { "content-type": "application/json", "x-expressive-call": "add" };

    expect(await send("POST", "/nowhere", call, `[${"1,".repeat(100_000)}1]`)).toBe(404);
    expect(await send("GET", "/")).toBe(200);

    agent.destroy();
    server.close();
    vi.restoreAllMocks();
  });

  it("will serve a prerendered page, else the 200.html shell by the page rule", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "client-"));
    mkdirSync(join(dir, "about"));
    writeFileSync(join(dir, "index.html"), "home");
    writeFileSync(join(dir, "200.html"), "shell");
    writeFileSync(join(dir, "about", "index.html"), "about");

    const server = listen({ settings: { port: 0 }, client: dir, pages: { patterns: ["/", "/about", "/blog/:slug"], assetsDir: "static" } });
    await new Promise(done => server.once("listening", done));

    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const html = { accept: "text/html" };
    const get = async (path: string, init?: RequestInit) => {
      const reply = await fetch(base + path, init);
      return `${reply.status} ${await reply.text()}`;
    };

    expect(await get("/")).toBe("200 home");
    expect(await get("/about")).toBe("200 about");
    expect(await get("/about/")).toBe("200 about");
    expect(await get("/blog/one")).toBe("200 shell");
    expect(await get("/nope", { headers: html })).toBe("404 shell");
    expect(await get("/nope")).toBe("404 Not found");
    expect(await get("/static/gone.js", { headers: html })).toBe("404 Not found");
    expect(await get("/blog/one", { method: "POST", headers: html })).toBe("404 Not found.");
    expect(await get("/about", { method: "POST" })).toBe("404 Not found.");

    server.closeAllConnections();
    server.close();
    vi.restoreAllMocks();
  });

  it("will run handle around calls and files, with the file step as next", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const store = new AsyncLocalStorage<string>();
    const dir = mkdtempSync(join(tmpdir(), "client-"));
    writeFileSync(join(dir, "200.html"), "<head></head>");
    writeFileSync(join(dir, "robots.txt"), "robots");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "1");

    const settings = {
      port: 0,
      async handle({ request, env, ctx, next }: HandleArgs) {
        const { pathname } = new URL(request.url);

        if (pathname === "/hello") {
          ctx.waitUntil(Promise.reject(new Error("late")));
          return Response.json({ env });
        }

        if (pathname !== "/invite/abc") return store.run("inside", () => next());

        const page = await next();
        return new Response(`${page.status} ${await page.text()}`.replace("</head>", "<meta></head>"), page);
      },
    };

    const exports = async () => ({ calls: { where: async () => store.getStore() }, classes: {} });
    const server = listen({ settings, client: dir, sidecars: [{ pattern: ["tally"], exports } as any], pages: { patterns: ["/invite/:code"] } });
    await new Promise(done => server.once("listening", done));

    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const invite = await fetch(base + "/invite/abc");
    const where = await fetch(`${base}/tally`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "where" }, body: "[]" });

    expect(await (await fetch(base + "/hello")).json()).toEqual({ env: {} });
    expect(await invite.text()).toBe("200 <head><meta></head>");
    expect(invite.headers.get("content-type")).toContain("text/html");
    expect(await where.json()).toMatchObject({ value: "inside" });
    expect(await (await fetch(base + "/robots.txt")).text()).toBe("robots");
    expect((await fetch(base + "/assets/app.js")).headers.get("cache-control")).toContain("immutable");
    expect((await fetch(base + "/assets/gone.js")).headers.has("cache-control")).toBe(false);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("waitUntil:", new Error("late")));

    server.closeAllConnections();
    server.close();
    vi.restoreAllMocks();
  });

  it("will reply 404 with no file and no shell", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const server = listen({ settings: { port: 0 }, client: mkdtempSync(join(tmpdir(), "client-")) });
    await new Promise(done => server.once("listening", done));

    const { port } = server.address() as AddressInfo;
    const status = await new Promise<number>(done => request({ port, path: "/" }, res => (res.resume(), done(res.statusCode!))).end());

    expect(status).toBe(404);

    server.close();
    vi.restoreAllMocks();
  });

  it("will check sidecars before it listens, on port 3000 by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exports = vi.fn(async () => ({ calls: {}, classes: { Oops: class Oops extends Error {} } }));

    const server = listen({ settings: {}, client: tmpdir(), sidecars: [{ pattern: ["todos"], exports } as any] });
    const bound = vi.spyOn(server, "listen").mockImplementation(((port: number, done: () => void) => (done(), server)) as any);

    await vi.waitFor(() => expect(bound).toHaveBeenCalled());

    expect(exports).toHaveBeenCalled();
    expect(bound.mock.calls[0][0]).toBe(3000);
    expect(log).toHaveBeenCalledWith("Expressive running at http://localhost:3000/");

    vi.restoreAllMocks();
  });

  it("will serve a gated call and a file of unknown type", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "client-"));
    writeFileSync(join(dir, "data.bin"), "1");

    const exports = async () => ({ calls: { add: async (a: number, b: number) => a + b }, classes: {} });
    const server = listen({ settings: { port: 0 }, client: dir, sidecars: [{ pattern: ["tally"], exports } as any], gates: [{ pattern: ["tally"], gate: () => {} }] });
    await new Promise(done => server.once("listening", done));

    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const call = await fetch(`${base}/tally`, { method: "POST", headers: { "content-type": "application/json", "x-expressive-call": "add" }, body: "[2, 3]" });
    const file = await fetch(`${base}/data.bin`);

    expect(await call.json()).toMatchObject({ value: 5 });
    expect(file.headers.get("content-type")).toBe("application/octet-stream");

    server.closeAllConnections();
    server.close();
    vi.restoreAllMocks();
  });
});
