import { expect, it, vi } from "vitest";

const build = vi.hoisted(() => vi.fn(async () => {}));

const prerender = vi.hoisted(() => vi.fn(async () => []));

vi.mock("vite", async importOriginal => ({ ...(await importOriginal<object>()), build }));
vi.mock("./prerender", () => ({ prerender }));

import { clientBuild, prerenderBuild, runBuild, serverBuild } from "./build";

it("will build the client, the server, then prerender", async () => {
  await runBuild("/app", { pretty: true });

  expect(build.mock.calls.map(([config]: any) => config.build.outDir)).toEqual(["dist/client", "dist/server"]);
  expect(build.mock.calls[0]).toMatchObject([{ root: "/app", build: { minify: false } }]);
  expect(prerender).toHaveBeenCalledWith("/app", { pretty: true });
});

it("will not prerender when opted out or building in memory", async () => {
  prerender.mockClear();

  await runBuild("/app", { html: false });
  await runBuild("/app", { write: false });

  expect(prerender).not.toHaveBeenCalled();
});

it("will warn and keep the client build if prerendering fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  prerender.mockRejectedValueOnce(new Error("window is not defined"));

  await expect(runBuild("/app")).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith("Prerendering failed - every page renders in the browser: window is not defined");

  warn.mockRestore();
});

it("will bundle the prerender entry as one module", () => {
  expect(prerenderBuild("/app", "/app/dist/.prerender")).toMatchObject({
    root: "/app",
    build: { outDir: "/app/dist/.prerender", rollupOptions: { input: "/.expressive/prerender.tsx", output: { entryFileNames: "prerender.js", codeSplitting: false } } },
  });
  expect((prerenderBuild("/app", "/out").build!.rollupOptions!.output as any).assetFileNames).toBeUndefined();
  expect(prerenderBuild("/app", "/out", { pretty: true }).build!.rollupOptions!.output).toMatchObject({ assetFileNames: "[name].[ext]" });
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
