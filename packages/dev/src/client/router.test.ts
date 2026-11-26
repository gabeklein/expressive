import { afterEach, expect, it, vi } from "vitest";
import { client } from "@expressive/rpc";

import { entering, Router } from "./router";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("will move without history where there is no window", async () => {
  const router = Router.new();

  router.goto("/next?q=1");
  await Promise.resolve();

  expect(router.path).toBe("/next");
  router.set(null);
});

it("will leave the entering path for a hook's synchronous run, and none without a window", () => {
  const read = () => (globalThis as any)[Symbol.for("@expressive/dev#path")];

  expect(entering("/a", read)).toBeUndefined();

  vi.stubGlobal("window", {});

  expect(entering("/a", () => [read(), entering("/b", read), read()])).toEqual(["/a", "/b", "/a"]);
  expect(() => entering("/c", () => { throw new Error("Broke."); })).toThrow("Broke.");
  expect(read()).toBeUndefined();
});

it("will push history in a browser", async () => {
  const pushState = vi.fn();

  vi.stubGlobal("window", { location: { pathname: "/", search: "", hash: "" }, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("history", { pushState, replaceState: vi.fn() });

  const router = Router.new();
  const active = () => (globalThis as any)[Symbol.for("@expressive/dev#router")];
  expect(active()).toBe(router);

  router.goto("/next");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(pushState).toHaveBeenCalledWith(null, "", "/next");
  expect(active().path).toBe("/next");
  router.goto("/blog/new");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client().pathOf(["blog", ":id"], "save", active().path)).toBe("/blog/new");
  router.set(null);
  expect(active()).toBeUndefined();
});
