import { Current } from "@expressive/rpc";
import { expect, expectTypeOf, it } from "vitest";

import { config } from "./settings";

declare module "@expressive/env" {
  interface Env {
    readonly FROM_DOTENV?: string;
  }
}

declare module "@expressive/dev" {
  interface Env {
    DB?: { prepare(sql: string): unknown };
    ASSETS?: { fetch(request: Request): Promise<Response> };
  }
}

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

it("will type env with the keys expressive env declares and those an app adds", () => {
  config({
    env: async () => ({ DB: { prepare: () => 1 } }),
    handle({ env }) {
      expectTypeOf(env.FROM_DOTENV).toEqualTypeOf<string | undefined>();
      expectTypeOf(env.DB!.prepare).toEqualTypeOf<(sql: string) => unknown>();
    },
  });

  expectTypeOf(() => Current.get().env.FROM_DOTENV).returns.toEqualTypeOf<string | undefined>();
  // @ts-expect-error env returns the bindings, not a string
  config({ env: () => "DB" });
});
