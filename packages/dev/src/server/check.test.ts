import { describe, expect, it } from "vitest";

import { check } from "./check";

describe("check", () => {
  it("will return settings it reads", () => {
    const settings = { target: "fetch", port: 1, remote: {}, handle() {}, host: () => ({}) };

    expect(check(settings, ["default", "Room"])).toBe(settings);
  });

  it("will name where a 0.5 key went", () => {
    expect(() => check({ fetch() {} })).toThrow("index.ts: `fetch` and `around` became `handle`. See ");
    expect(() => check({ around() {} })).toThrow("`fetch` and `around` became `handle`.");
    expect(() => check({ scheduled() {} })).toThrow("`scheduled` goes in `host`.");
    expect(() => check({ ports: 1 })).toThrow("`ports` is not a setting.");
    expect(() => check({ env: () => ({}) })).toThrow("`env` is set in index.dev.ts, never index.ts.");
  });

  it("will throw for a bindings export, pointing at index.dev.ts", () => {
    expect(() => check({}, ["default", "bindings"])).toThrow("`bindings` became `settings.env`, set in index.dev.ts.");
    expect(() => check({}, ["default", "bindings"], "index.dev.ts")).toThrow("index.dev.ts: `bindings` became `settings.env`");
  });

  it("will read env from index.dev.ts only", () => {
    const settings = { port: 1, env: () => ({}) };

    expect(check(settings, ["default"], "index.dev.ts")).toBe(settings);
    expect(check({ env: undefined }, [], "index.dev.ts")).toEqual({ env: undefined });
    expect(() => check({ around() {} }, [], "index.dev.ts")).toThrow("index.dev.ts: `fetch` and `around` became `handle`.");
    expect(() => check({ env: {} }, [], "index.dev.ts")).toThrow("index.dev.ts: `env` is a function returning the bindings");
    expect(() => check(undefined, [], "index.dev.ts")).toThrow("index.dev.ts: no default export");
  });

  it("will throw for host off the fetch target", () => {
    expect(() => check({ host: () => ({}) })).toThrow("`host` is for the fetch target only");
  });

  it("will throw for a default export that is not settings", () => {
    expect(() => check(null)).toThrow("the default export is not config({ ... }).");
  });
});
