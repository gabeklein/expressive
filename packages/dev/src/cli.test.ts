import { afterEach, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async () => 3));
const trunk = vi.hoisted(() => vi.fn(() => run));

vi.mock("@expressive/cli/bin", () => ({ trunk }));

const { argv, exitCode } = process;

afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
});

it("will run the expressive trunk", async () => {
  process.argv = ["node", "expressive", "dev", "--port", "1"];
  await import("./cli");

  expect(trunk).toHaveBeenCalledWith("expressive");
  expect(run).toHaveBeenCalledWith(["dev", "--port", "1"], console);
  expect(process.exitCode).toBe(3);
});
