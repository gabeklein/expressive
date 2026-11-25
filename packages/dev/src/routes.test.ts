import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { expect, it } from "vitest";

import config from "../tsdown.config";

it("will build with the root and /routes sharing one entering path", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "dev-dist-"));

  try {
    await build({ ...config, config: false, cwd: fileURLToPath(new URL("..", import.meta.url)), outDir, dts: false, sourcemap: false, logLevel: "silent" });

    const files = readdirSync(outDir).filter(file => file.endsWith(".js"));
    const read = (file: string) => readFileSync(join(outDir, file), "utf8");
    const holders = files.filter(file => read(file).includes("function entering("));

    expect(holders).toHaveLength(1);
    expect(read("index.js")).toContain(`from "./${holders[0]}"`);
    expect(read("routes.js")).toContain(`from "./${holders[0]}"`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
