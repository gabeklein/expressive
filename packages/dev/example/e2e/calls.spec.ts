import { expect, test } from "./fixture";

test("calls a sidecar's functions on the server", async ({ page, open }, { project }) => {
  await open("/tally");
  const output = page.locator("output");

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(output).toHaveText("undefined");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(output).toHaveText("1");

  await page.reload();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(output).toHaveText("2");

  await page.getByRole("button", { name: "Add 10" }).click();
  await expect(output).toHaveText("Overflow at 9");

  await page.getByRole("button", { name: "Where" }).click();
  await expect(output).toHaveText("/tally");

  await page.getByRole("button", { name: "Fail" }).click();
  await expect(output).toHaveText(project.name == "dev" ? "Nope" : "Internal error.");
});

test("calls the root sidecar from a nested page", async ({ page, open }) => {
  await open("/blog/hello");

  await page.getByRole("button", { name: "Where" }).click();
  await expect(page.locator("output")).toHaveText("/");
});

test("calls a param folder's sidecar from its own page, params filled", async ({ page, open }) => {
  await open("/note/7");

  await page.getByRole("button", { name: "Where" }).click();
  await expect(page.locator("output")).toHaveText("/note/7");
});

test("calls a param folder's sidecar from its default during an in-app navigation", async ({ page, open }) => {
  await open("/");
  await page.getByRole("link", { name: "Note 7" }).click();

  await expect(page.getByRole("heading")).toHaveText("Note");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("calls the outgoing page's sidecar while a navigation is held, from its own location", async ({ page, open }) => {
  const held: string[] = [];

  await page.route(url => url.pathname == "/gate" || url.pathname == "/note/8", async route => {
    if (route.request().method() != "POST") return route.continue();
    held.push(new URL(route.request().url()).pathname);
  });

  await open("/note/7");
  await page.getByRole("link", { name: "Gate" }).click();
  await expect.poll(() => held).toEqual(["/gate"]);
  await page.getByRole("button", { name: "Where" }).click();
  await expect(page.locator("output")).toHaveText("/note/7");

  await open("/note/7");
  await page.getByRole("link", { name: "Note 8" }).click();
  await expect.poll(() => held).toEqual(["/gate", "/note/8"]);
  await page.getByRole("button", { name: "Where" }).click();
  await expect(page.locator("output")).toHaveText("/note/7");
});

test("rebuilds a sidecar's http error subclass as an HttpError", async ({ page, open }) => {
  await open("/tally");

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("output")).toHaveText("HttpError 423: The tally is closed.");
});
