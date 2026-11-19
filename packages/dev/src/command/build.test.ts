import { command } from "@expressive/cli";
import { beforeEach, expect, it, vi } from "vitest";

import Build from "./build";

const runBuild = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../vite/build", () => ({ runBuild }));

const out = { log: vi.fn(), error: vi.fn() };
const build = command(Build);

beforeEach(() => runBuild.mockClear());

it("will build", async () => {
  expect(await build([], out)).toBe(0);
  expect(runBuild).toHaveBeenCalledWith(process.cwd(), { pretty: false, html: true });
});

it("will build without prerendering on --no-html", async () => {
  expect(await build(["--no-html"], out)).toBe(0);
  expect(runBuild).toHaveBeenCalledWith(process.cwd(), { pretty: false, html: false });
});

it("will build with --pretty", async () => {
  expect(await build(["--pretty"], out)).toBe(0);
  expect(runBuild).toHaveBeenCalledWith(process.cwd(), { pretty: true, html: true });
});

it("will not build on an unknown option", async () => {
  expect(await build(["--ugly"], out)).toBe(2);
  expect(out.error.mock.calls[0][0]).toMatch(/^Unknown option --ugly\./);
  expect(runBuild).not.toHaveBeenCalled();
});
