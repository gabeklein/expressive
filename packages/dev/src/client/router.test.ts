import { afterEach, expect, it, vi } from "vitest";

import { entered, entering, Router } from "./router";

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
  expect(entering("/a", entered)).toBeUndefined();

  vi.stubGlobal("window", {});

  expect(entering("/a", () => [entered(), entering("/b", entered), entered()])).toEqual(["/a", "/b", "/a"]);
  expect(() => entering("/c", () => { throw new Error("Broke."); })).toThrow("Broke.");
  expect(entered()).toBeUndefined();
});

it("will push history in a browser", async () => {
  const pushState = vi.fn();

  vi.stubGlobal("window", { location: { pathname: "/", search: "", hash: "" }, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("history", { pushState, replaceState: vi.fn() });

  const router = Router.new();

  router.goto("/next");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(pushState).toHaveBeenCalledWith(null, "", "/next");
  router.set(null);
});
