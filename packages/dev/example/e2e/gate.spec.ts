import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./fixture";

const pass = (context: BrowserContext, url: string | undefined, value: string) => context.addCookies([{ name: "gate", value, url: url! }]);

function calls(page: Page, path: string) {
  const sent: string[] = [];

  page.on("request", request => {
    if (new URL(request.url()).pathname == path && request.headers()["x-expressive-call"]) sent.push(request.postData()!);
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
  await page.route(url => url.pathname == "/api/gate", async route => {
    await held;
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

test("redirects to login when the gate refuses with a Redirect", async ({ page, open }) => {
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
  await page.route(url => url.pathname == "/api/gate", () => {});

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

test("calls once on entry with the id, none inside the folder, and once on a param change", async ({ page, open }) => {
  const sent = calls(page, "/api/room");

  await open("/");
  await page.getByRole("link", { name: "Room 1" }).click();
  await expect(page.getByRole("heading")).toHaveText("Room 1");
  expect(sent).toEqual(['["1"]']);

  await page.getByRole("link", { name: "Notes" }).click();
  await expect(page.getByRole("heading")).toHaveText("Notes");
  await page.goBack();
  await page.getByRole("link", { name: "Room 2" }).click();
  await expect(page.getByRole("heading")).toHaveText("Room 2");
  expect(sent).toEqual(['["1"]', '["2"]']);
});

test("guards a param folder's page below its index by the folder's id", async ({ page, open }) => {
  const sent = calls(page, "/api/room");

  await open("/room/3/notes");
  await expect(page.getByRole("heading")).toHaveText("Notes");
  expect(sent).toEqual(['["3"]']);
});

test("calls nothing for a static page beside a guarded param folder, or outside it", async ({ page, open }) => {
  const sent = calls(page, "/api/room");

  await open("/room/new");
  await expect(page.getByRole("heading")).toHaveText("New room");
  await page.getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page.getByRole("heading")).toHaveText("Blog index");

  expect(sent).toEqual([]);
});

test("shows a refusal in Catch, and calls again on retry", async ({ page, open }) => {
  const sent = calls(page, "/api/room");

  await open("/");
  await page.getByRole("link", { name: "Locked room" }).click();
  await expect(page.getByRole("alert")).toContainText("This room is locked.");

  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => sent).toEqual(['["locked"]', '["locked"]']);
  await expect(page.getByRole("alert")).toContainText("This room is locked.");
});

test("redirects where a call's Redirect points", async ({ page, open }) => {
  await open("/");
  await page.getByRole("link", { name: "Old room" }).click();

  await expect(page).toHaveURL("/room/new");
  await expect(page.getByRole("heading")).toHaveText("New room");
});

test("follows a call's Redirect to another room", async ({ page, open }) => {
  test.fail(true, "a redirect to another value of the same param - fixed in #859");
  await open("/");
  await page.getByRole("link", { name: "Moved room" }).click();

  await expect(page).toHaveURL("/room/1");
  await expect(page.getByRole("heading")).toHaveText("Room 1");
});

test("follows a call's Redirect to another room on a cold load", async ({ page, open: _ }) => {
  test.fail(true, "a redirect to another value of the same param - fixed in #859");
  await page.goto("/room/moved");

  await expect(page).toHaveURL("/room/1");
  await expect(page.getByRole("heading")).toHaveText("Room 1");
});

test("enters another room from a page below the folder's index", async ({ page, open }) => {
  const sent = calls(page, "/api/room");

  await open("/room/1/notes");
  await page.getByRole("link", { name: "Room 2" }).click();

  await expect(page.getByRole("heading")).toHaveText("Room 2");
  expect(sent).toEqual(['["1"]', '["2"]']);
});

test("drops a superseded call's refusal", async ({ page, open }) => {
  let release!: () => void;
  const held = new Promise<void>(done => (release = done));

  await page.route(url => url.pathname == "/api/room", async route => {
    await held;
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
