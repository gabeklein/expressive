import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixture";

const LOG = fileURLToPath(new URL("../.e2e/dev.log", import.meta.url));

test("warns in dev when a twin's field changes in place", async ({ page, context, baseURL, open }) => {
  test.setTimeout(60_000);
  await context.addCookies([{ name: "studio", value: "drift", url: baseURL! }]);
  await open("/jobs");

  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("link", { name: "job1" }).click();
  await expect(page.getByText("0 notes")).toBeVisible();

  const before = readFileSync(LOG, "utf8").length;

  await page.getByRole("button", { name: "Note" }).click();
  await expect(page.getByText("0 notes")).toBeVisible();

  await expect.poll(() => readFileSync(LOG, "utf8").slice(before), { timeout: 40_000 }).toContain("Job.notes changed in place");
});
