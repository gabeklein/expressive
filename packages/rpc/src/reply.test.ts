import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "@expressive/mvc";

import { Forbidden, HttpError, Redirect } from "./errors";
import { refusal, toReply, withHeaders, type Source } from "./reply";

const plainStream = (source: Source) =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await source.next();

      if (done) controller.close();
      else controller.enqueue(typeof value == "string" ? new TextEncoder().encode(value) : value);
    },
    cancel: reason => void source.stop(reason),
  });

const reply = (...args: unknown[]) => toReply(args, plainStream);

describe("toReply", () => {
  it("will send plain values as JSON, honouring toJSON", async () => {
    const res = reply({ a: [1, true, null], at: new Date(0), none: Object.create(null) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ a: [1, true, null], at: "1970-01-01T00:00:00.000Z", none: {} });
    expect(await reply(201, 42).json()).toBe(42);
    expect(reply(201, 42).status).toBe(201);
  });

  it("will throw for a Model, another class, a Map or a bigint", () => {
    class Item extends Model {}
    class Plain { a = 1; }

    expect(() => reply(Item.new())).toThrow("Cannot send Item - send its values.");
    expect(() => reply({ item: new Plain() })).toThrow("Cannot send Plain - send its values.");
    expect(() => reply(new Map())).toThrow("Cannot send Map - send its values.");
    expect(() => reply({ n: 1n })).toThrow("Cannot send a bigint");
    expect(() => reply(() => {})).toThrow("Cannot send a function");
  });

  it("will send a string as text, bytes and forms as Response takes them", async () => {
    const text = reply("hi");

    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toBe("hi");
    expect(await reply(new Uint8Array([104, 105])).text()).toBe("hi");
    expect(await reply(new TextEncoder().encode("hi").buffer).text()).toBe("hi");
    expect(await reply(new Blob(["hi"])).text()).toBe("hi");
    expect(await reply(new URLSearchParams({ a: "1" })).text()).toBe("a=1");
    expect((await reply(new FormData()).formData())).toBeInstanceOf(FormData);
  });

  it("will stream a ReadableStream or an async iterable", async () => {
    async function* lines() {
      yield "a\n";
      yield new TextEncoder().encode("b\n");
    }

    expect(await reply(lines()).text()).toBe("a\nb\n");
    expect(await reply(200, new Response("piped").body).text()).toBe("piped");
  });

  it("will cancel an iterable without a return", async () => {
    const iterable = { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: "x" }) }) };

    await reply(iterable).body!.cancel();
  });

  it("will cancel a stream it pipes", async () => {
    const cancel = vi.fn();

    await reply(new ReadableStream({ cancel })).body!.cancel("gone");
    expect(cancel).toHaveBeenCalledWith("gone");
  });

  it("will reply 204 without a body unless a status is given, and refuse a body with a bodiless status", () => {
    expect(reply().status).toBe(204);
    expect(reply(200).status).toBe(200);
    expect(reply(304).status).toBe(304);
    expect(() => reply(204, "x")).toThrow("A 204 reply has no body.");
    expect(() => reply(304, {})).toThrow("A 304 reply has no body.");
    expect(() => reply(103, "x")).toThrow("A 103 reply has no body.");
  });

  it("will take a Response as the whole reply", () => {
    const res = new Response("x");
    expect(reply(res)).toBe(res);
  });
});

describe("withHeaders", () => {
  it("will let a Response's own headers win, setHeader over the body rule's type", () => {
    const extra = new Headers({ "content-type": "application/x-ndjson", "x-a": "1" });
    const own = withHeaders(new Response("x", { headers: { "content-type": "text/csv" } }), extra);
    const ruled = withHeaders(reply("x"), extra);

    expect(own.headers.get("content-type")).toBe("text/csv");
    expect(own.headers.get("x-a")).toBe("1");
    expect(ruled.headers.get("content-type")).toBe("application/x-ndjson");
  });

  it("will add a cookie once", () => {
    const extra = new Headers();

    extra.append("set-cookie", "a=1");
    extra.append("set-cookie", "b=2");

    const res = withHeaders(new Response(null, { headers: [["set-cookie", "a=1"]] }), extra);

    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("will keep the reply as is with nothing to add", () => {
    const res = new Response("x");

    expect(withHeaders(res)).toBe(res);
    expect(withHeaders(res, new Headers())).toBe(res);
  });
});

describe("refusal", () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => void (error = vi.spyOn(console, "error").mockImplementation(() => {})));
  afterEach(() => error.mockRestore());

  it("will answer an HttpError's status as JSON, a Redirect with its location", async () => {
    const denied = refusal(new Forbidden("No."));
    const moved = refusal(new Redirect("/login", 303));

    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ message: "No." });
    expect(moved.status).toBe(303);
    expect(moved.headers.get("location")).toBe("/login");
    expect(error).not.toHaveBeenCalled();
  });

  it("will log anything else and answer 500", async () => {
    const odd = Object.assign(new HttpError("odd"), { status: 302 });
    const res = refusal(new Error("boom"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal error." });
    expect(refusal(odd).status).toBe(500);
    expect(error).toHaveBeenCalledTimes(2);
  });
});
