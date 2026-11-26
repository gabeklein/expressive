import { expect, test } from "./fixture";

test("answers an api/ route's verbs, reading the body and params", async ({ request }) => {
  const hello = await request.get("/api/hello");
  const head = await request.head("/api/hello");
  const echo = await request.post("/api/echo", { data: { a: 1 } });

  expect(await hello.json()).toEqual({ hello: "world" });
  expect([head.status(), await head.text()]).toEqual([200, ""]);
  expect(await echo.json()).toEqual({ echo: { a: 1 } });
  expect(await (await request.get("/api/photo/a%20b")).json()).toEqual({ photo: "a b" });
});

test("refuses a method a route does not export with 405 and Allow", async ({ request }) => {
  const reply = await request.delete("/api/hello");

  expect([reply.status(), reply.headers()["allow"]]).toEqual([405, "GET, HEAD"]);
});

test("hands a catch-all's paths to the fetch handler it returns", async ({ request }) => {
  const reply = await request.put("/api/legacy/users/1");

  expect(await reply.json()).toEqual({ legacy: "/api/legacy/users/1", method: "PUT" });
});

test("gates a folder by its index default, on paths it serves and ones it doesn't", async ({ request }) => {
  const refused = await request.get("/api/admin/me");
  const unmatched = await request.get("/api/admin/nope");
  const admin = { headers: { cookie: "admin=root" } };

  expect([refused.status(), await refused.json()]).toEqual([403, { message: "Admins only." }]);
  expect(unmatched.status()).toBe(403);
  expect(await (await request.get("/api/admin/me", admin)).json()).toEqual({ admin: "root" });
  expect((await request.get("/api/admin/nope", admin)).status()).toBe(404);
});

test("answers an unmatched /api path with a JSON 404, never the shell", async ({ request }) => {
  const reply = await request.get("/api/nope", { headers: { accept: "text/html" } });

  expect([reply.status(), reply.headers()["content-type"]]).toEqual([404, "application/json"]);
  expect(await reply.json()).toEqual({ message: "No route in api/ serves /api/nope - paths under /api belong to api/." });
});

test("serves no route for a bare-named helper beside the routes, naming it in dev", async ({ request }, { project }) => {
  const reply = await request.get("/api/greeting");
  const hint = "api/greeting.ts is a helper - rename it api/(greeting).ts to serve /api/greeting.";

  expect(reply.status()).toBe(404);
  expect((await reply.json()).message).toBe(project.name == "dev" ? hint : "No route in api/ serves /api/greeting - paths under /api belong to api/.");
});
