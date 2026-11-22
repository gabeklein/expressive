import { expect, it } from "vitest";

import { config } from "./config";

it("will return the config it is given", () => {
  const options = { port: 3000 };

  expect(config(options)).toBe(options);
});

it("will type around to resolve what next resolves", () => {
  const session = <T>(fn: () => Promise<T>, _client: unknown) => fn();

  config({ around: (next, { env, request }) => session(next, [env, request]) });
  // @ts-expect-error
  config({ around: async () => 1 });
});
