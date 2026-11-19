import { command } from "@expressive/cli";
import { expect, it, vi } from "vitest";

const main = vi.hoisted(() => vi.fn((_meta: unknown, Type: unknown) => Type));

vi.mock("@expressive/cli", async (actual) => ({ ...(await actual<object>()), main }));

it("will export Env as a member of the expressive command", async () => {
  const { default: Env } = await import("./cli");
  const out = { log: vi.fn(), error: vi.fn() };

  expect(Env).toBe((await import("./command")).default);
  expect(main).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/cli\.ts$/) }), Env, { as: "expressive" });

  expect(await command(Env)(["--help"], out, "expressive env")).toBe(0);
  expect(out.log.mock.calls[0][0]).toMatch(/^Usage: expressive env \[options\] \[command\]\n\nSet up env.d.ts, then check/);
});
