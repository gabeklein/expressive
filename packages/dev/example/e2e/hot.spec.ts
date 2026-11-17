import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixture";

test.describe.configure({ mode: "serial" });

const REMOTE = fileURLToPath(new URL("../app/jobs/remote.ts", import.meta.url));
const original = readFileSync(REMOTE, "utf8");

const edit = (from: string, to: string) => {
  const now = readFileSync(REMOTE, "utf8");
  expect(now).toContain(from);
  writeFileSync(REMOTE, now.replace(from, to));
};

test.afterAll(() => writeFileSync(REMOTE, original));

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

test("restarts a structurally changed seat cleanly, the open tab rejoining", async ({ page, open }) => {
  await open("/jobs");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.evaluate(() => ((window as any).kept = true));

  edit(`  label = "";`, `  label = "";\n  extra = 0;`);
  await expect(page.getByRole("listitem")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).kept)).toBe(true);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("li progress")).toHaveJSProperty("value", 5);
});
