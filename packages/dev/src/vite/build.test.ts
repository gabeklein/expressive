import { expect, it, vi } from "vitest";

const build = vi.hoisted(() => vi.fn(async () => {}));

const prerender = vi.hoisted(() => vi.fn(async () => []));

vi.mock("vite", async importOriginal => ({ ...(await importOriginal<object>()), build }));
vi.mock("./prerender", () => ({ prerender }));

import { clientBuild, prerenderBuild, runBuild, serverBuild } from "./build";

it("will build the client, then the server", async () => {
  await runBuild("/app", { pretty: true });

  expect(build.mock.calls.map(([config]: any) => config.build.outDir)).toEqual(["dist/client", "dist/server"]);
  expect(build.mock.calls[0]).toMatchObject([{ root: "/app", build: { minify: false } }]);
  expect(prerender).not.toHaveBeenCalled();
});

it("will prerender after both builds when asked", async () => {
  await runBuild("/app", { prerender: true });

  expect(prerender).toHaveBeenCalledWith("/app");
});

it("will bundle the prerender entry as one module", () => {
  expect(prerenderBuild("/app", "/app/dist/.prerender")).toMatchObject({
    root: "/app",
    build: { outDir: "/app/dist/.prerender", rollupOptions: { input: "/.expressive/prerender.tsx", output: { entryFileNames: "prerender.js", codeSplitting: false } } },
  });
});

it("will build the working directory by default", async () => {
  build.mockClear();

  await runBuild();

  expect(build).toHaveBeenCalledWith(expect.objectContaining({ root: process.cwd() }));
});

it("will minify and write by default", () => {
  expect(clientBuild("/app").build).toMatchObject({ minify: true, write: true });
  expect(serverBuild("/app").build).toMatchObject({ write: true });
});
