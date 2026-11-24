import { describe, expect, it, vi } from "vitest";

import { bodyOf, capped, originOf, parsed } from "./body";
import { BadRequest, NotFound, PayloadTooLarge } from "./errors";

const post = (body: BodyInit | null, type = "application/json", headers: Record<string, string> = {}) =>
  new Request("http://localhost/", { method: "POST", body, headers: { "content-type": type, ...headers } });

describe("bodyOf", () => {
  it("will read the body once, every kind of read deriving from it", async () => {
    const origin = post('{"a":1}');
    const read = vi.spyOn(origin, "arrayBuffer");
    const request = bodyOf(origin);

    expect(bodyOf(origin)).toBe(request);
    expect(bodyOf(request)).toBe(request);
    expect(originOf(request)).toBe(origin);
    expect(originOf(origin)).toBe(origin);

    expect(await request.json()).toEqual({ a: 1 });
    expect(await request.text()).toBe('{"a":1}');
    expect(new TextDecoder().decode(await request.arrayBuffer())).toBe('{"a":1}');
    expect(await (await request.blob()).text()).toBe('{"a":1}');
    expect((await request.blob()).type).toBe("application/json");
    expect(await request.clone().text()).toBe('{"a":1}');
    expect(await new Request(request.clone()).text()).toBe('{"a":1}');
    expect(await new Response(request.body).text()).toBe('{"a":1}');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("will read form data and an empty body", async () => {
    const form = new URLSearchParams({ a: "1" });

    expect((await bodyOf(post(form, "application/x-www-form-urlencoded")).formData()).get("a")).toBe("1");
    expect(await new Response(bodyOf(post("")).body).text()).toBe("");
    expect(bodyOf(new Request("http://localhost/")).body).toBeNull();
    expect((await bodyOf(new Request("http://localhost/", { headers: {} })).blob()).type).toBe("");
  });

  it("will leave the body unread until something asks", () => {
    const origin = post("{}");

    bodyOf(origin);
    expect(origin.bodyUsed).toBe(false);
  });
});

describe("capped", () => {
  it("will refuse a body over 1 MB by its length or its bytes", async () => {
    const big = "x".repeat((1 << 20) + 1);

    await expect(capped(post("{}", "text/plain", { "content-length": String(1 << 21) }))).rejects.toBeInstanceOf(PayloadTooLarge);
    await expect(capped(bodyOf(post(big, "text/plain")))).rejects.toThrow("The body is over 1 MB.");
    expect(await capped(bodyOf(post("hi", "text/plain")))).toBe("hi");
  });
});

describe("parsed", () => {
  const read = (body: string, type?: string, check?: (value: unknown) => unknown) => parsed(bodyOf(post(body, type)), check);

  it("will parse JSON of a json or +json type, undefined when empty", async () => {
    expect(await read('{"a":1}')).toEqual({ a: 1 });
    expect(await read("[1]", "application/ld+json; charset=utf-8")).toEqual([1]);
    expect(await read("", "text/plain")).toBeUndefined();
  });

  it("will refuse another type or invalid JSON with BadRequest", async () => {
    await expect(read("{}", "text/plain")).rejects.toThrow(new BadRequest("Expected a JSON body."));
    await expect(read("{", undefined)).rejects.toThrow(new BadRequest("The body is not valid JSON."));
    await expect(parsed(bodyOf(new Request("http://localhost/", { method: "POST", body: new Uint8Array([49]) })))).rejects.toBeInstanceOf(BadRequest);
  });

  it("will pass the value through a check, a throw refusing with BadRequest unless an HttpError", async () => {
    expect(await read('{"a":1}', undefined, value => (value as { a: number }).a + 1)).toBe(2);
    expect(await read("", undefined, value => value ?? "none")).toBe("none");

    await expect(read("{}", undefined, () => { throw new Error("a is required"); })).rejects.toThrow(new BadRequest("a is required"));
    await expect(read("{}", undefined, () => { throw "bad"; })).rejects.toThrow(new BadRequest("bad"));
    await expect(read("{}", undefined, () => { throw new NotFound("no"); })).rejects.toBeInstanceOf(NotFound);
  });
});
