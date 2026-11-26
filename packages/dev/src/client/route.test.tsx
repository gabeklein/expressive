// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Redirect } from "@expressive/rpc";

import { browserRouter, location, mount, settle } from "../../test.setup";
import { Route } from "./route";

afterEach(() => vi.unstubAllGlobals());

it("will reject a caught error during server rendering", async () => {
  const route = Route.new();
  const error = new Error("server");
  vi.stubGlobal("window", undefined);

  await expect(route.catch(error)).rejects.toBe(error);
  route.set(null);
});

describe("browser errors", () => {
  const router = browserRouter() as unknown as { current: { path: string; set(key: "path"): unknown } };

  it("will keep a caught error on the same path and ignore a second retry", async () => {
    let retry: (() => void) | undefined;
    const Catch = ({ retry: again }: { retry: () => void }) => {
      retry = again;
      return <p>caught</p>;
    };
    location("/broken");
    const root = await mount(() => <Route Catch={Catch}><Route to="broken" as={() => { throw new Error("broken"); }} /></Route>);

    expect(root.textContent).toBe("caught");
    router.current.set("path");
    await settle();
    expect(root.textContent).toBe("caught");
    retry!();
    retry!();
    await settle();
  });

  it("will show Catch when a redirect cannot navigate", async () => {
    let route!: Route;
    class Failed extends Route {
      Catch = () => <p>caught</p>;
      goto(): never { throw new Error("navigation failed"); }
      render() { route = this; return <p>ready</p>; }
    }
    location("/");
    await mount(Failed);
    const pending = route.catch(new Redirect("/other"));
    await settle();
    const retry = (route.fallback as { props: { retry: () => void } }).props.retry;
    expect(retry).toBeTypeOf("function");
    retry();
    await pending;
  });
});
