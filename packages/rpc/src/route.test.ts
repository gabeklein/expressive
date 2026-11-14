import { describe, expect, it } from "vitest";

import { reserved, route, walk, type Tree } from "./route";

describe("route", () => {
  const list = async () => [];
  const ban = async () => {};
  const root = () => {};
  const admin = () => {};

  it("will copy its children and keep the gate out of them", () => {
    const children = { list };
    const tree = route(root, children);

    expect(tree).toEqual({ list });
    expect(tree).not.toBe(children);
    expect(Object.keys(tree)).toEqual(["list"]);
  });

  it("will throw if a child takes a reserved name, at any depth", () => {
    expect(() => route(root, { with: list })).toThrow("with is reserved for the client - name it otherwise.");
    expect(() => route(root, { a: { then: list } })).toThrow("a.then is reserved for the client");
    expect(() => reserved({ a: { b: list } })).not.toThrow();
  });

  it("will find a call with the gates along its path, one per segment and the root's first", () => {
    const tree = route(root, { list, todos: { list }, admin: route(admin, { users: { ban } }) });

    expect(walk(tree, [], "list")).toEqual({ fn: list, seats: [root] });
    expect(walk(tree, ["todos"], "list")).toEqual({ fn: list, seats: [root, undefined] });
    expect(walk(tree, ["admin", "users"], "ban")).toEqual({ fn: ban, seats: [root, admin, undefined] });
    expect(walk({ list }, [], "list")).toEqual({ fn: list, seats: [undefined] });
  });

  it("will not find what is not a call at its path", () => {
    const tree = { list, todos: { list, count: 1 } } as unknown as Tree;

    expect(walk(tree, ["todos"], "count")).toBeUndefined();
    expect(walk(tree, ["todos"], "missing")).toBeUndefined();
    expect(walk(tree, ["list"], "list")).toBeUndefined();
    expect(walk(tree, ["nowhere"], "list")).toBeUndefined();
    expect(walk(tree, [], "todos")).toBeUndefined();
    expect(walk(tree, [], "toString")).toBeUndefined();
    expect(walk(tree, ["__proto__"], "toString")).toBeUndefined();
  });
});
