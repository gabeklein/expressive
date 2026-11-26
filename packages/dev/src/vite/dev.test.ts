import { expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ listen: vi.fn(async () => {}), printUrls: vi.fn() }));
const createServer = vi.hoisted(() => vi.fn(async (_config: { mode?: string; plugins: ({ name: string } | false)[] }) => server));

vi.mock("vite", async importOriginal => ({ ...(await importOriginal<object>()), createServer }));
vi.mock("@expressive/dom/vite", () => ({ default: () => ({ name: "hot" }) }));
vi.mock("@expressive/inspect/vite", () => ({ default: () => ({ name: "inspect" }) }));
vi.mock("@expressive/env/vite", () => ({ env: () => ({ name: "env" }) }));

const registered = vi.hoisted(() => vi.fn());

vi.mock("@expressive/env", () => ({ register: registered }));
const host = vi.hoisted(() => vi.fn((_dotenv: boolean) => ({ name: "expressive", api: { config: async () => ({ port: 4000 }) } })));

vi.mock("./plugin", () => ({ host }));

import { runDev } from "./dev";

it("will listen on the configured port", async () => {
  await runDev("/app");

  expect(createServer).toHaveBeenCalledWith(expect.objectContaining({ root: "/app" }));
  expect(server.listen).toHaveBeenCalledWith(4000);
  expect(server.printUrls).toHaveBeenCalled();
});

it("will listen on a given port over the configured one", async () => {
  await runDev("/app", { port: 5180 });

  expect(createServer).toHaveBeenLastCalledWith(expect.objectContaining({ server: { port: 5180 } }));
  expect(server.listen).toHaveBeenLastCalledWith(5180);
});

it("will serve the working directory by default", async () => {
  await runDev();

  expect(createServer).toHaveBeenLastCalledWith(expect.objectContaining({ root: process.cwd() }));
});

it("will always add hot reload and env, and the inspect relay unless turned off", async () => {
  const names = () => createServer.mock.lastCall![0].plugins.map((plugin) => plugin && plugin.name);

  await runDev("/app");
  expect(names()).toEqual(["expressive", "hot", "env", "inspect"]);

  await runDev("/app", { inspect: false, env: false });
  expect(names()).toEqual(["expressive", "hot", "env", false]);
});

it("will register .env before the server starts", () => {
  expect(registered).toHaveBeenCalledBefore(createServer);
});

it("will not register .env for --no-env", async () => {
  registered.mockClear();

  await runDev("/app", { env: false });
  expect(registered).not.toHaveBeenCalled();
  expect(host).toHaveBeenLastCalledWith(false);
});

it("will take its mode from NODE_ENV", async () => {
  vi.stubEnv("NODE_ENV", "staging");
  await runDev("/app");
  expect(createServer.mock.lastCall![0].mode).toBe("staging");

  vi.stubEnv("NODE_ENV", "");
  await runDev("/app");
  expect(createServer.mock.lastCall![0].mode).toBeUndefined();

  vi.unstubAllEnvs();
});
