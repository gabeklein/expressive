import { expect, it, vi } from "vitest";

import dev from "./dev";

const runDev = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../vite/dev", () => ({ runDev }));

const out = { log: vi.fn(), error: vi.fn() };

it("will run the dev server", async () => {
  expect(await dev([], out)).toBe(0);
  expect(runDev).toHaveBeenCalledWith();
});

it("will return 1 with the message of a failure", async () => {
  runDev.mockRejectedValueOnce(new Error("broke"));

  expect(await dev([], out)).toBe(1);
  expect(out.error).toHaveBeenCalledWith("broke");
});
