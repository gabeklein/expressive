import { expect, test } from "./fixture";

test("calls an api/ route's functions on the server", async ({ page, open }, { project }) => {
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
  await expect(output).toHaveText("/api/tally");

  await page.getByRole("button", { name: "Fail" }).click();
  await expect(output).toHaveText(project.name == "dev" ? "Nope" : "Internal error.");
});

test("calls the same route from any page", async ({ page, open }) => {
  await open("/blog/hello");

  await page.getByRole("button", { name: "Where" }).click();
  await expect(page.locator("output")).toHaveText("/api/served");
});

test("passes a param page's id to its route default's call, on load and in-app", async ({ page, open }) => {
  const sent: string[] = [];

  page.on("request", request => {
    if (new URL(request.url()).pathname == "/api/note") sent.push(request.postData()!);
  });

  await open("/note/7");
  await expect(page.locator("output")).toHaveText("Note 7 from the server");

  await page.getByRole("link", { name: "Note 8" }).click();
  await expect(page.locator("output")).toHaveText("Note 8 from the server");
  await expect(page).toHaveURL("/note/8");
  expect(sent).toEqual(['["7"]', '["8"]']);
});

test("rebuilds a route's http error subclass as an HttpError", async ({ page, open }) => {
  await open("/tally");

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("output")).toHaveText("HttpError 423: The tally is closed.");
});
