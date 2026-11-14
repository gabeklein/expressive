import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runDev = vi.hoisted(() => vi.fn(async () => {}));
const runBuild = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("./vite/dev", () => ({ runDev }));
vi.mock("./vite/build", () => ({ runBuild }));

const { argv, exitCode } = process;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  runDev.mockReset();
  runBuild.mockReset();
});

async function run(...args: string[]) {
  process.argv = ["node", "expressive", ...args];
  await import("./cli");

  return process.exitCode;
}

it("will run dev", async () => {
  expect(await run("dev")).toBe(0);
  expect(runDev).toHaveBeenCalled();
});

it("will run build", async () => {
  expect(await run("build", "--pretty")).toBe(0);
  expect(runBuild).toHaveBeenCalledWith(process.cwd(), { pretty: true });
});

it("will print help", async () => {
  expect(await run("--help")).toBe(0);
  expect(log.mock.calls[0][0]).toMatch(/^Usage: expressive \[options\] <command>/);
});

it("will list commands when none is given", async () => {
  expect(await run()).toBe(2);
  expect(error.mock.calls[0][0]).toMatch(/dev +Vite dev server/);
  expect(runDev).not.toHaveBeenCalled();
});

it("will exit 2 on an unknown command", async () => {
  expect(await run("deploy")).toBe(2);
  expect(error.mock.calls[0][0]).toMatch(/^Unknown command "deploy"\./);
});
