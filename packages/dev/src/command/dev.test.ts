import { command } from "@expressive/cli";
import { beforeEach, expect, it, vi } from "vitest";

import Dev from "./dev";

const runDev = vi.hoisted(() => vi.fn(async () => {}));
const runBuild = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../vite/dev", () => ({ runDev }));
vi.mock("../vite/build", () => ({ runBuild }));

const out = { log: vi.fn(), error: vi.fn() };
const dev = command(Dev);

beforeEach(() => {
  vi.clearAllMocks();
});

it("will run the dev server", async () => {
  expect(await dev([], out)).toBe(0);
  expect(runDev).toHaveBeenCalledWith();
  expect(runBuild).not.toHaveBeenCalled();
});

it("will return 1 with the message of a failure", async () => {
  runDev.mockRejectedValueOnce(new Error("broke"));

  expect(await dev([], out)).toBe(1);
  expect(out.error).toHaveBeenCalledWith("broke");
});

it("will build as a subcommand", async () => {
  expect(await dev(["build", "--pretty"], out, "expressive dev")).toBe(0);
  expect(runBuild).toHaveBeenCalledWith(process.cwd(), { pretty: true });
  expect(runDev).not.toHaveBeenCalled();
});

it("will list build in help", async () => {
  expect(await dev(["--help"], out, "expressive dev")).toBe(0);
  expect(out.log.mock.calls[0][0]).toMatch(/^Usage: expressive dev \[options\] \[command\]\n[^]*build +dist\/client/);
});
