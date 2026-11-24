import { expect, it } from "vitest";

import { config } from "./settings";

it("will return the settings it is given", () => {
  const settings = { port: 3000 };

  expect(config(settings)).toBe(settings);
});

it("will type handle as middleware taking one object", () => {
  const session = <T>(fn: () => Promise<T>, _client: unknown) => fn();
  const legacy = { fetch: async (_request: Request, _env: unknown, _ctx: unknown) => new Response() };

  config({ handle: ({ env, next }) => session(next, env) });
  // @ts-expect-error a fetch handler is not middleware
  config({ handle: legacy.fetch });
  // @ts-expect-error 0.5's keys are gone
  config({ around: next => next() });
});
