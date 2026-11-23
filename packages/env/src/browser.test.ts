import { expect, it } from "vitest";

import { env, register } from "./browser";

const read = env as unknown as Record<string | symbol, unknown>;

it("will throw reading a key without the Vite plugin", () => {
  expect(() => read.API_URL).toThrow('env.API_URL has no value in the browser - add env() from "@expressive/env/vite"');
});

it("will not throw for probes", () => {
  expect(read.then).toBeUndefined();
  expect(read[Symbol.toPrimitive]).toBeUndefined();
});

it("will throw on register", () => {
  expect(() => register()).toThrow("register() fills process.env - call it on the server.");
});
