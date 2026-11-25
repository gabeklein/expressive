// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/" }

import { Redirect as Moved, Unauthorized } from "@expressive/rpc";
import type { BrowserRouter } from "@expressive/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserRouter, location, mount, settle } from "../../test.setup";
import { Route } from ".";
import { gateCheck, type GateNode } from "./check";

function Err({ error, retry }: { error: Error; retry: () => void }) {
  return <button onClick={retry}>caught: {error.message}</button>;
}

const text = (label: string) => () => <p>{label}</p>;

const pass = () => vi.fn(async (_path: string, _name: string, _args: unknown[]): Promise<unknown> => true);

const TREE: GateNode = {
  none: 1,
  in: [
    { to: "login", page: 1 },
    { to: "about", page: 1 },
    { to: "admin", gate: 1, page: 1, in: [{ to: "settings", page: 1 }, { to: "users", gate: 1, page: 1, in: [] }] },
    { to: "room", in: [{ to: "new", page: 1 }, { to: ":id", gate: 1, page: 1, in: [] }] },
  ],
};

describe("gateCheck", () => {
  const router = browserRouter() as unknown as { current: BrowserRouter };
  const flush = () => settle().then(settle);
  const goto = (path: string) => (router.current.goto(path), flush());
  const paths = (call: ReturnType<typeof pass>) => call.mock.calls.map(([path]) => path);

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
      <Route to="room">
        <Route to="new" as={text("new room")} />
        <Route to=":id" as={text("room")} enter={checked()} />
      </Route>
    </Route>
  );

  it("will send one check on entry, none inside the folder, one on a param change", async () => {
    const call = pass();
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/admin");
    expect(root.textContent).toBe("admin");
    await goto("/admin/settings");
    await goto("/about");
    await goto("/admin");
    expect(paths(call)).toEqual(["/admin"]);

    await goto("/room/1");
    await goto("/room/2");
    expect(root.textContent).toBe("room");
    expect(paths(call)).toEqual(["/admin", "/room/1", "/room/2"]);
  });

  it("will check the folder the router enters, with a static sibling before a param", async () => {
    const call = pass();
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/room/new");
    expect(root.textContent).toBe("new room");
    expect(call).not.toHaveBeenCalled();

    await goto("/room/7");
    expect(paths(call)).toEqual(["/room/7"]);
  });

  it("will check a folder's own spelling of a path in another case", async () => {
    const call = pass();
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/ADMIN");
    expect(root.textContent).toBe("admin");
    await goto("/Room/AbC");
    expect(paths(call)).toEqual(["/admin", "/room/AbC"]);
  });

  it("will check the deepest gated folder once for every gated Route on the path", async () => {
    const call = pass();
    location("/admin/users");
    const root = await mount(tree(gateCheck(call, TREE)));
    await flush();

    expect(root.textContent).toBe("users");
    expect(paths(call)).toEqual(["/admin/users"]);

    await goto("/admin");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("will enter without remembering a check that could not tell", async () => {
    const call = pass().mockResolvedValueOnce(false);
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/admin");
    expect(root.textContent).toBe("admin");
    await goto("/about");
    await goto("/admin");
    await goto("/about");
    await goto("/admin");

    expect(paths(call)).toEqual(["/admin", "/admin"]);
  });

  it("will run the folder's own hook after a pass, and start its load with the check", async () => {
    const call = pass();
    const load = vi.fn(async () => {
      throw new Error("Offline.");
    });
    const hook = vi.fn(() => "/login");
    const checked = gateCheck(call, { none: 1, in: [{ to: "login", page: 1 }, { to: "admin", gate: 1, page: 1, in: [] }] });
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
    const call = pass().mockRejectedValueOnce(new Unauthorized("Sign in.")).mockRejectedValueOnce(new Unauthorized("Still no."));
    location("/admin");
    const root = await mount(tree(gateCheck(call, TREE)));
    await flush();

    expect(root.textContent).toBe("caught: Sign in.");

    (root.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();
    expect(root.textContent).toBe("caught: Still no.");

    (root.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();

    expect(call).toHaveBeenCalledTimes(3);
    expect(root.textContent).toBe("admin");
  });

  it("will redirect through the router where a refusal points, and to Catch if that is the same folder", async () => {
    const call = pass()
      .mockRejectedValueOnce(new Moved("/login?from=admin"))
      .mockRejectedValueOnce(new Moved("http://localhost/admin/users"));
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/admin");
    await flush();
    expect(root.textContent).toBe("login");
    expect(window.location.pathname + window.location.search).toBe("/login?from=admin");

    await goto("/admin");
    await flush();
    expect(root.textContent).toBe("caught: http://localhost/admin/users");
  });

  it("will follow one redirect between gated folders, and stop at Catch on the way back", async () => {
    const call = pass()
      .mockRejectedValueOnce(new Moved("/room/1"))
      .mockRejectedValueOnce(new Moved("/admin"));
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/admin");
    await flush();
    await flush();

    expect(paths(call)).toEqual(["/admin", "/room/1"]);
    expect(root.textContent).toBe("caught: /admin");
  });

  it("will leave through location.assign for another origin or a path no page serves", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const call = pass()
      .mockRejectedValueOnce(new Moved("https://auth.example.com/sign-in"))
      .mockRejectedValueOnce(new Moved("/about/extra"));
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/admin");
    expect(assign).toHaveBeenCalledWith("https://auth.example.com/sign-in");
    expect(root.textContent).toBe("");

    await goto("/room/1");
    expect(assign).toHaveBeenLastCalledWith("http://localhost/about/extra");
  });

  it("will show a redirect to another scheme in Catch", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const call = pass().mockRejectedValueOnce(new Moved("javascript:alert(1)"));
    const root = await mount(tree(gateCheck(call, TREE)));

    await goto("/admin");

    expect(assign).not.toHaveBeenCalled();
    expect(root.textContent).toBe("caught: javascript:alert(1)");
  });

  it("will drop a superseded check's verdict and redirect, remembering no pass", async () => {
    let refuse!: (error: Error) => void;
    let admit!: () => void;
    const call = pass()
      .mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)))
      .mockReturnValueOnce(new Promise(resolve => (admit = () => resolve(true))));
    const root = await mount(tree(gateCheck(call, TREE)));

    router.current.goto("/admin");
    await flush();
    router.current.goto("/room/1");
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    refuse(new Moved("/login"));
    await flush();
    await goto("/nowhere");
    admit();
    await flush();
    expect(root.textContent).toBe("");

    await goto("/room/1");
    expect(paths(call)).toEqual(["/admin", "/room/1", "/room/1"]);
    expect(root.textContent).toBe("room");
  });

  it("will share an in-flight check, and check again after a gate edit", async () => {
    let listener!: () => void;
    const call = pass();
    const checked = gateCheck(call, { gate: 1, none: 1, in: [{ to: "about", page: 1 }, { to: "admin", gate: 1, page: 1, in: [] }] }, { on: (_, done) => (listener = done) });
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
    call.mockReturnValueOnce(new Promise(resolve => (admit = () => resolve(true))));
    await goto("/admin");
    await goto("/about");
    await goto("/admin");
    admit();
    await flush();
    await goto("/about");
    await goto("/admin");
    expect(paths(call)).toEqual(["/", "/admin"]);

    listener();
    await goto("/about");
    await goto("/admin");
    expect(paths(call)).toEqual(["/", "/admin", "/admin"]);
    expect(root.textContent).toBe("admin");
  });

  it("will match a path under base without it, check it with it, and leave the app for a redirect outside it", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const call = pass().mockRejectedValueOnce(new Moved("/app/login")).mockRejectedValueOnce(new Moved("/login"));
    const checked = gateCheck(call, { none: 1, in: [{ to: "login", page: 1 }, { to: "admin", gate: 1, page: 1, in: [] }] }, undefined, "/app/");
    const Tree = () => (
      <Route fallback={null}>
        <Route to="app">
          <Route to="login" as={text("login")} />
          <Route to="admin" as={text("admin")} enter={checked()} />
        </Route>
      </Route>
    );

    location("/app/admin");
    const root = await mount(Tree);
    await flush();
    expect(root.textContent).toBe("login");

    await goto("/app/admin");
    expect(assign).toHaveBeenCalledWith("http://localhost/login");

    await goto("/app/login");
    await goto("/app/admin");
    expect(root.textContent).toBe("admin");
    expect(paths(call)).toEqual(["/app/admin", "/app/admin", "/app/admin"]);
  });

  it("will check a catch-all folder at the whole path, a relative base counting as /", async () => {
    const call = pass();
    const checked = gateCheck(call, { none: 1, in: [{ to: "docs", in: [{ to: "*", gate: 1, page: 1, in: [] }] }] }, undefined, "./");
    const Tree = () => (
      <Route fallback={null}>
        <Route to="docs">
          <Route to="*" as={text("docs")} enter={checked()} />
        </Route>
      </Route>
    );

    location("/docs/a/b");
    await mount(Tree);
    await flush();

    expect(paths(call)).toEqual(["/docs/a/b"]);
  });

  it("will pass without a window", async () => {
    const call = pass();
    const hook = vi.fn();

    vi.stubGlobal("window", undefined);
    gateCheck(call, TREE)(hook)({ router: { path: "/admin" } } as Route);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });
});
