import type { BrowserContext } from "@playwright/test";

import { expect, test } from "./fixture";

const as = (context: BrowserContext, url: string | undefined, value: string) => context.addCookies([{ name: "studio", value, url: url! }]);
const someone = () => `user-${Math.random().toString(36).slice(2)}`;

test("shows a has() pool's members, each one's progress updating live", async ({ page, context, baseURL, open }) => {
  await as(context, baseURL, someone());
  await open("/jobs");

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Start" }).click();

  const bars = page.locator("li progress");

  await expect(bars).toHaveCount(2);
  await expect(bars.nth(0)).toHaveJSProperty("value", 5);
  await expect(bars.nth(1)).toHaveJSProperty("value", 5);
  await expect(page.getByRole("link", { name: "job2" })).toBeVisible();
});

test("opens one member by key on its own page, live, and again after a reload", async ({ page, context, baseURL, open }) => {
  await as(context, baseURL, someone());
  await open("/jobs");

  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("link", { name: "job1" }).click();

  await expect(page.getByRole("heading")).toHaveText("Job job1");
  await expect(page.locator("progress")).toHaveJSProperty("value", 5);

  await page.getByRole("button", { name: "Note" }).click();
  await page.reload();
  await expect(page.getByRole("heading")).toHaveText("Job job1");
  await expect(page.getByText("1 notes")).toBeVisible();
});

test("refuses a member's page to another identity", async ({ page, context, baseURL, browser, open }) => {
  await as(context, baseURL, someone());
  await open("/jobs");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);

  const other = await browser.newContext({ baseURL });
  const stranger = await other.newPage();

  await as(other, baseURL, someone());
  await stranger.goto("/jobs/job1");
  await expect(stranger.getByRole("alert")).toContainText("Not found.");
  await other.close();
});
