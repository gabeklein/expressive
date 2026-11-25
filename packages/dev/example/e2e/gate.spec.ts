import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./fixture";

const pass = (context: BrowserContext, url: string | undefined, value: string) => context.addCookies([{ name: "gate", value, url: url! }]);

function checks(page: Page) {
  const sent: string[] = [];

  page.on("request", request => {
    if (request.headers()["x-expressive-get"] === "gates") sent.push(new URL(request.url()).pathname);
  });

  return sent;
}

test("admits a visitor the gate lets through", async ({ page, context, baseURL, open }) => {
  await pass(context, baseURL, "ada");
  await open("/gate");

  await expect(page.getByRole("heading")).toHaveText("Gate");
  await expect(page.getByText("Welcome, ada")).toBeVisible();
});

test("holds the current page until the gate admits a navigation", async ({ page, context, baseURL, open }) => {
  let release!: () => void;
  const held = new Promise<void>(done => (release = done));

  await pass(context, baseURL, "ada");
  await page.route(url => url.pathname == "/gate", async route => {
    if (route.request().method() == "POST") await held;
    await route.continue();
  });

  await open("/");
  await page.getByRole("link", { name: "Gate" }).click();
  await expect(page.getByRole("heading")).toHaveText("Home");
  await expect(page).toHaveURL("/");

  release();
  await expect(page.getByRole("heading")).toHaveText("Gate");
  await expect(page).toHaveURL("/gate");
});

test("shows Catch when the gate refuses the visitor", async ({ page, context, baseURL, open: _ }) => {
  await pass(context, baseURL, "banned");
  await page.goto("/gate");

  await expect(page.getByRole("alert")).toContainText("Banned from the gate.");
});

test("redirects where the gate's refusal names a location", async ({ page, open }) => {
  await open("/gate");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading")).toHaveText("Login");
});

test("redirects a visitor the gate refuses for now", async ({ page, context, baseURL, open }) => {
  await pass(context, baseURL, "guest");
  await open("/gate");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading")).toHaveText("Login");
});

test("leaves the gate for another page while its admission is still pending", async ({ page, context, baseURL, open: _ }) => {
  await pass(context, baseURL, "ada");
  await page.route(url => url.pathname == "/gate", async route => {
    if (route.request().method() != "POST") return route.continue();
  });

  await page.goto("/gate");
  await expect(page.getByText("Loading…")).toBeVisible();

  await page.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading")).toHaveText("About");
});

test("shows Catch when the gate refuses an in-app navigation", async ({ page, context, baseURL, open }) => {
  await pass(context, baseURL, "banned");
  await open("/");
  await page.getByRole("link", { name: "Gate" }).click();

  await expect(page.getByRole("alert")).toContainText("Banned from the gate.");
});

test("sends one check on entry, none inside the folder, and one on a param change", async ({ page, open }) => {
  const sent = checks(page);

  await open("/");
  await page.getByRole("link", { name: "Room 1" }).click();
  await expect(page.getByRole("heading")).toHaveText("Room 1");
  expect(sent).toEqual(["/room/1"]);

  await page.getByRole("link", { name: "Notes" }).click();
  await expect(page.getByRole("heading")).toHaveText("Notes");
  await page.getByRole("link", { name: "Room 2" }).click();
  await expect(page.getByRole("heading")).toHaveText("Room 2");
  expect(sent).toEqual(["/room/1", "/room/2"]);
});

test("sends no check for a static page beside a gated param folder", async ({ page, open }) => {
  const sent = checks(page);

  await open("/room/new");
  await expect(page.getByRole("heading")).toHaveText("New room");

  expect(sent).toEqual([]);
});

test("enters on a failed check without remembering it", async ({ page, open }) => {
  const sent = checks(page);
  let failed = false;

  await page.route(url => url.pathname == "/room/1", async route => {
    if (route.request().method() != "POST" || failed) return route.continue();

    failed = true;
    await route.abort();
  });

  await open("/");
  await page.getByRole("link", { name: "Room 1" }).click();
  await expect(page.getByRole("heading")).toHaveText("Room 1");

  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Room 1" }).click();
  await expect(page.getByRole("heading")).toHaveText("Room 1");
  await expect.poll(() => sent).toEqual(["/room/1", "/room/1"]);
});

test("sends no check outside gated folders", async ({ page, open }) => {
  const sent = checks(page);

  await open("/");
  await page.getByRole("link", { name: "Blog" }).click();
  await expect(page.getByRole("heading")).toHaveText("Blog index");
  await page.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading")).toHaveText("About");

  expect(sent).toEqual([]);
});

test("shows a refusal in Catch, and checks again on retry", async ({ page, open }) => {
  const sent = checks(page);

  await open("/");
  await page.getByRole("link", { name: "Locked room" }).click();
  await expect(page.getByRole("alert")).toContainText("This room is locked.");

  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => sent).toEqual(["/room/locked", "/room/locked"]);
  await expect(page.getByRole("alert")).toContainText("This room is locked.");
});

test("redirects where a gate's 3xx Response points", async ({ page, open }) => {
  await open("/");
  await page.getByRole("link", { name: "Old room" }).click();

  await expect(page).toHaveURL("/room/1");
  await expect(page.getByRole("heading")).toHaveText("Room 1");
});

test("drops a superseded check's refusal", async ({ page, open }) => {
  let release!: () => void;
  const held = new Promise<void>(done => (release = done));

  await page.route(url => url.pathname == "/room/locked", async route => {
    if (route.request().method() == "POST") await held;
    await route.continue();
  });

  await open("/");
  await page.getByRole("link", { name: "Locked room" }).click();
  await page.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading")).toHaveText("About");

  release();
  await page.waitForTimeout(200);
  await expect(page.getByRole("heading")).toHaveText("About");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
