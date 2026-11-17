import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixture";

test.describe.configure({ mode: "serial" });

const REMOTE = fileURLToPath(new URL("../app/jobs/remote.ts", import.meta.url));
const INDEX = fileURLToPath(new URL("../index.ts", import.meta.url));
const originals = [REMOTE, INDEX].map(file => [file, readFileSync(file, "utf8")] as const);

const edit = (from: string, to: string, file = REMOTE) => {
  const now = readFileSync(file, "utf8");
  expect(now).toContain(from);
  writeFileSync(file, now.replace(from, to));
};

test.afterAll(() => originals.forEach(([file, text]) => writeFileSync(file, text)));

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "studio", value: "hot", url: baseURL! }]);
});

test("patches a method edit made during a call, the call finishing on the old code and the seat's state kept", async ({ page, open }) => {
  await open("/jobs");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("li progress")).toHaveJSProperty("value", 5);

  await page.getByRole("button", { name: "Slow" }).click();
  edit(`(this.label = "first")`, `(this.label = "second")`);
  await expect(page.locator("output")).toHaveText("first");

  await page.getByRole("button", { name: "Slow" }).click();
  await expect(page.locator("output")).toHaveText("second");
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("restarts a structurally changed seat cleanly, its page coming back fresh", async ({ page, open }) => {
  await open("/jobs");
  await expect(page.getByRole("listitem")).toHaveCount(1);

  edit(`  label = "";`, `  label = "";\n  extra = 0;`);
  await expect(page.getByRole("listitem")).toHaveCount(0);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("li progress")).toHaveJSProperty("value", 5);
});

test("restarts the server in place when its entry changes, the open tab rejoining without a reload", async ({ page, open }) => {
  await open("/jobs");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.evaluate(() => ((window as any).kept = true));

  edit(`export default config({`, `// restarted\nexport default config({`, INDEX);
  await expect(page.getByRole("listitem")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).kept)).toBe(true);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("li progress")).toHaveJSProperty("value", 5);
});
