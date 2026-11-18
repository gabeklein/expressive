import { expect, test } from "./fixture";

test("returns twin and watcher counts to where they were once a page lets its twins go", async ({ page, context, baseURL, request, open }) => {
  const stats = async () => (await request.get("/.expressive/stats")).json();

  await context.addCookies([{ name: "studio", value: "stats", url: baseURL! }]);
  await open("/jobs");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);

  const before = await stats();

  await page.getByRole("link", { name: "job1" }).click();
  await expect(page.getByRole("heading")).toHaveText("Job job1");
  await expect.poll(async () => (await stats()).twins).toBe(before.twins + 1);

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading")).toHaveText("Jobs");
  await expect.poll(async () => {
    const { twins, watchers, seats, pooled } = await stats();
    return { twins, watchers, seats, pooled };
  }).toEqual({ twins: before.twins, watchers: before.watchers, seats: before.seats, pooled: before.pooled });
});
