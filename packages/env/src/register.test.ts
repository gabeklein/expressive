import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.REGISTERED;
});

it("will fill process.env on import", async () => {
  const root = mkdtempSync(join(tmpdir(), "env-"));
  writeFileSync(join(root, ".env"), "REGISTERED=yes");
  vi.spyOn(process, "cwd").mockReturnValue(root);

  await import("./register");

  expect(process.env.REGISTERED).toBe("yes");
  rmSync(root, { recursive: true, force: true });
});
