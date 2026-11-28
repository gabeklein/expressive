import { expect, it } from "vitest";
import * as rpc from "@expressive/rpc";
import * as dev from "../index";

import * as server from ".";
import { compose } from ".";

it("will re-export rpc's HTTP error family from both entry points", () => {
  for (const name of ["HttpError", "BadRequest", "Unauthorized", "PaymentRequired", "Forbidden", "NotFound", "MethodNotAllowed", "Conflict", "Gone", "PayloadTooLarge", "UnprocessableEntity", "TooManyRequests", "InternalError", "NotImplemented", "ServiceUnavailable", "Redirect"] as const) {
    expect(dev[name]).toBe(rpc[name]);
    expect(server[name]).toBe(rpc[name]);
  }
});

it("will compose settings alone, pages through assets", async () => {
  const app = compose({ handle: async ({ next }) => new Response(`${(await next()).status}`) });
  const assets = { fetch: async () => new Response("shell") };

  expect(await (await app(new Request("http://x/invite/abc"), { assets })).text()).toBe("200");
  expect(await (await compose()(new Request("http://x/"))).text()).toBe("Not found.");
});
