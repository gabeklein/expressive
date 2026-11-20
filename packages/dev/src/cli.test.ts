import { command } from "@expressive/cli";
import { expect, it, vi } from "vitest";

const main = vi.hoisted(() => vi.fn((_meta: unknown, Type: unknown) => Type));

vi.mock("@expressive/cli", async (actual) => ({ ...(await actual<object>()), main }));

it("will export Dev as a member of the expressive command", async () => {
  const { default: Dev } = await import("./cli");
  const out = { log: vi.fn(), error: vi.fn() };

  expect(Dev).toBe((await import("./command/dev")).default);
  expect(main).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/cli\.ts$/) }), Dev, { as: "expressive" });

  expect(await command(Dev)(["--help"], out, "expressive dev")).toBe(0);
  expect(out.log.mock.calls[0][0]).toMatch(/^Usage: expressive dev \[options\] \[command\]\n\nRun the app - Vite/);
});
