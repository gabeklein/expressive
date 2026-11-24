import { expect, it } from "vitest";

import { compose } from ".";

it("will compose settings alone, pages through assets", async () => {
  const app = compose({ handle: async ({ next }) => new Response(`${(await next()).status}`) });
  const assets = { fetch: async () => new Response("shell") };

  expect(await (await app(new Request("http://x/invite/abc"), { assets })).text()).toBe("200");
  expect(await (await compose()(new Request("http://x/"))).text()).toBe("Not found.");
});
