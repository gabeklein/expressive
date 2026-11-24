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
    expect(() => check({}, ["default", "bindings"])).toThrow("`bindings` became `config.env`, set in index.dev.ts.");
  });

  it("will throw for host off the fetch target", () => {
    expect(() => check({ host: () => ({}) })).toThrow("`host` is for the fetch target only");
  });

  it("will throw for a default export that is not settings", () => {
    expect(() => check(null)).toThrow("the default export is not config({ ... }).");
  });
});
