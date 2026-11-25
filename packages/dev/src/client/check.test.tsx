// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/" }

import { Redirect as Moved, Unauthorized } from "@expressive/rpc";
import type { BrowserRouter } from "@expressive/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserRouter, location, mount, settle } from "../../test.setup";
import { gateCheck, Route } from ".";

function Err({ error, retry }: { error: Error; retry: () => void }) {
  return <button onClick={retry}>caught: {error.message}</button>;
}

const text = (label: string) => () => <p>{label}</p>;

describe("gateCheck", () => {
  const router = browserRouter() as unknown as { current: BrowserRouter };
  const flush = () => settle().then(settle);
  const goto = (path: string) => (router.current.goto(path), flush());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tree = (checked: ReturnType<typeof gateCheck>, hook?: (route: Route) => string | void) => () => (
    <Route Catch={Err} fallback={null}>
      <Route to="login" as={text("login")} />
      <Route to="about" as={text("about")} />
      <Route to="admin" enter={checked(hook)}>
        <Route as={text("admin")} />
        <Route to="settings" as={text("settings")} />
        <Route to="users" enter={checked()}>
          <Route as={text("users")} />
        </Route>
      </Route>
      <Route to="shop/:id" as={text("shop")} enter={checked()} />
    </Route>
  );

  const PATTERNS = ["/admin", "/admin/users", "/shop/:id"];

  it("will send one check on entry, none inside the folder, one on a param change", async () => {
    const call = vi.fn(async (_path: string, _name: string, _args: unknown[]) => undefined);
    const root = await mount(tree(gateCheck(call, PATTERNS)));

    await goto("/admin");
    expect(root.textContent).toBe("admin");
    await goto("/admin/settings");
    await goto("/about");
    await goto("/admin");
    expect(call.mock.calls).toEqual([["/admin", "", []]]);

    await goto("/shop/1");
    await goto("/shop/2");
    expect(root.textContent).toBe("shop");
    expect(call.mock.calls.slice(1)).toEqual([["/shop/1", "", []], ["/shop/2", "", []]]);
  });

  it("will check the deepest gated folder once for every gated Route on the path", async () => {
    const call = vi.fn(async (_path: string, _name: string, _args: unknown[]) => undefined);
    location("/admin/users");
    const root = await mount(tree(gateCheck(call, PATTERNS)));
    await flush();

    expect(root.textContent).toBe("users");
    expect(call.mock.calls).toEqual([["/admin/users", "", []]]);

    await goto("/admin");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("will run the folder's own hook after a pass, and start its load with the check", async () => {
    const call = vi.fn(async (_path: string, _name: string, _args: unknown[]) => undefined);
    const load = vi.fn(async () => {
      throw new Error("Offline.");
    });
    const hook = vi.fn(() => "/login");
    const checked = gateCheck(call, ["/admin"]);
    const Tree = () => (
      <Route fallback={null}>
        <Route to="login" as={text("login")} />
        <Route to="admin" as={text("admin")} enter={checked(hook, load)} />
      </Route>
    );

    location("/admin");
    const root = await mount(Tree);
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe("login");
  });

  it("will show a refusal in Catch, and check again on retry", async () => {
    const call = vi.fn<(path: string) => Promise<unknown>>().mockRejectedValueOnce(new Unauthorized("Sign in.")).mockResolvedValue(undefined);
    location("/admin");
    const root = await mount(tree(gateCheck(call, PATTERNS)));
    await flush();

    expect(root.textContent).toBe("caught: Sign in.");

    (root.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();

    expect(call).toHaveBeenCalledTimes(2);
    expect(root.textContent).toBe("admin");
  });

  it("will redirect through the router where a refusal points, and to Catch if that is the same folder", async () => {
    const call = vi.fn<(path: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Moved("/login?from=admin"))
      .mockRejectedValueOnce(new Moved("http://localhost/admin/users"));
    const root = await mount(tree(gateCheck(call, PATTERNS)));

    await goto("/admin");
    await flush();
    expect(root.textContent).toBe("login");
    expect(window.location.pathname + window.location.search).toBe("/login?from=admin");

    await goto("/admin");
    await flush();
    expect(root.textContent).toBe("caught: http://localhost/admin/users");
  });

  it("will leave for another origin through location.assign", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const call = vi.fn(async () => {
      throw new Moved("https://auth.example.com/sign-in");
    });
    location("/admin");
    const root = await mount(tree(gateCheck(call, PATTERNS)));
    await flush();

    expect(assign).toHaveBeenCalledWith("https://auth.example.com/sign-in");
    expect(root.textContent).toBe("");
  });

  it("will drop a superseded check's verdict and redirect, remembering no pass", async () => {
    let refuse!: (error: Error) => void;
    let admit!: () => void;
    const call = vi.fn<(path: string) => Promise<unknown>>()
      .mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)))
      .mockReturnValueOnce(new Promise(resolve => (admit = () => resolve(undefined))))
      .mockResolvedValue(undefined);
    const root = await mount(tree(gateCheck(call, PATTERNS)));

    router.current.goto("/admin");
    await flush();
    router.current.goto("/shop/1");
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    refuse(new Moved("/login"));
    await flush();
    await goto("/about");
    admit();
    await flush();
    expect(root.textContent).toBe("about");

    await goto("/shop/1");
    expect(call.mock.calls.map(([path]) => path)).toEqual(["/admin", "/shop/1", "/shop/1"]);
    expect(root.textContent).toBe("shop");
  });

  it("will share an in-flight check, and check again after a gate edit", async () => {
    let listener!: () => void;
    const call = vi.fn(async (_path: string, _name: string, _args: unknown[]) => undefined);
    const checked = gateCheck(call, ["/", "/admin"], { on: (_, done) => (listener = done) });
    const Tree = () => (
      <Route enter={checked()} fallback={null}>
        <Route to="about" as={text("about")} />
        <Route to="admin" as={text("admin")} enter={checked()} />
      </Route>
    );

    location("/about");
    const root = await mount(Tree);
    await flush();

    let admit!: () => void;
    call.mockReturnValueOnce(new Promise(resolve => (admit = () => resolve(undefined))));
    await goto("/admin");
    await goto("/about");
    await goto("/admin");
    admit();
    await flush();
    await goto("/about");
    await goto("/admin");
    expect(call.mock.calls.map(([path]) => path)).toEqual(["/", "/admin"]);

    listener();
    await goto("/about");
    await goto("/admin");
    expect(call.mock.calls.map(([path]) => path)).toEqual(["/", "/admin", "/admin"]);
    expect(root.textContent).toBe("admin");
  });

  it("will check a catch-all folder at the whole path", async () => {
    const call = vi.fn(async (_path: string, _name: string, _args: unknown[]) => undefined);
    const checked = gateCheck(call, ["/docs/*"]);
    const Tree = () => (
      <Route fallback={null}>
        <Route to="docs/*" as={text("docs")} enter={checked()} />
      </Route>
    );

    location("/docs/a/b");
    await mount(Tree);
    await flush();

    expect(call.mock.calls).toEqual([["/docs/a/b", "", []]]);
  });

  it("will pass where no gated folder matches, and without a window", async () => {
    const call = vi.fn(async (_path: string, _name: string, _args: unknown[]) => undefined);
    const hook = vi.fn();
    const enter = gateCheck(call, ["/admin"])(hook);
    const route = { router: { path: "/Elsewhere" } } as Route;

    enter(route);
    vi.stubGlobal("window", undefined);
    enter(route);

    expect(hook).toHaveBeenCalledTimes(2);
    expect(call).not.toHaveBeenCalled();
  });
});
