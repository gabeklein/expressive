import { expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ listen: vi.fn(async () => {}), printUrls: vi.fn() }));
const createServer = vi.hoisted(() => vi.fn(async (_config: { plugins: { name: string }[] }) => server));

vi.mock("vite", async importOriginal => ({ ...(await importOriginal<object>()), createServer }));
vi.mock("@expressive/inspect/vite", () => ({ default: () => ({ name: "inspect" }) }));
vi.mock("./plugin", () => ({ expressive: () => ({ name: "expressive", api: { config: async () => ({ port: 4000 }) } }) }));

import { runDev } from "./dev";

it("will listen on the configured port", async () => {
  await runDev("/app");

  expect(createServer).toHaveBeenCalledWith(expect.objectContaining({ root: "/app" }));
  expect(server.listen).toHaveBeenCalledWith(4000);
  expect(server.printUrls).toHaveBeenCalled();
});

it("will serve the working directory by default", async () => {
  await runDev();

  expect(createServer).toHaveBeenLastCalledWith(expect.objectContaining({ root: process.cwd() }));
});

it("will add the inspect relay unless turned off", async () => {
  const names = () => createServer.mock.lastCall![0].plugins.map((plugin) => plugin.name);

  await runDev("/app");
  expect(names()).toEqual(["expressive", "inspect"]);

  await runDev("/app", { inspect: false });
  expect(names()).toEqual(["expressive"]);
});
