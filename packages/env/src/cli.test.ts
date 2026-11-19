import { command } from "@expressive/cli";
import type { Model } from "@expressive/mvc";
import { expect, it, vi } from "vitest";

const main = vi.hoisted(() => vi.fn());

vi.mock("@expressive/cli", async (actual) => ({ ...(await actual<object>()), main }));

it("will export Env and run the expressive command as entry", async () => {
  const { default: Env } = await import("./cli");
  const [[meta, Expressive]] = main.mock.calls as [[ImportMeta, Model.Type]];
  const out = { log: vi.fn(), error: vi.fn() };

  expect(Env).toBe((await import("./command")).default);
  expect(meta.url).toMatch(/cli\.ts$/);

  expect(await command(Expressive)(["env", "--help"], out)).toBe(0);
  expect(out.log.mock.calls.pop()![0]).toMatch(/^Usage: expressive env \[options\] <command>\n\nType, check, list and edit/);

  expect(await command(Expressive)([], out)).toBe(0);
  expect(out.log.mock.calls[0][0]).toMatch(/\n {2}dev +Run the app[^\n]*\n {2}env +Type, check[^\n]*\n {2}sql +Check or sync/);
});
