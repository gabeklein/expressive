import { command } from "@expressive/cli";
import type { Model } from "@expressive/mvc";
import { expect, it, vi } from "vitest";

const main = vi.hoisted(() => vi.fn());

vi.mock("@expressive/cli", async (actual) => ({ ...(await actual<object>()), main }));

it("will export Dev and run the expressive command as entry", async () => {
  const { default: Dev } = await import("./cli");
  const [[meta, Expressive]] = main.mock.calls as [[ImportMeta, Model.Type]];
  const out = { log: vi.fn(), error: vi.fn() };

  expect(Dev).toBe((await import("./command/dev")).default);
  expect(meta.url).toMatch(/cli\.ts$/);

  expect(await command(Expressive)(["dev", "--help"], out)).toBe(0);
  expect(out.log.mock.calls.pop()![0]).toMatch(/^Usage: expressive dev \[options\] \[command\]\n\nRun the app - Vite/);

  expect(await command(Expressive)([], out)).toBe(0);
  expect(out.log.mock.calls[0][0]).toMatch(/^Usage: expressive \[options\] <command>\n\nCommands:\n {2}dev +Run the app - Vite[^\n]*\n {2}env +Set up env.d.ts[^\n]*\n {2}sql +Check or sync a database schema/);
});
