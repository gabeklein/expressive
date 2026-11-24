import { Model } from "@expressive/mvc";

import { HttpError, Redirect } from "./errors";

type Chunk = Uint8Array | string;

export type Source = { next(): Promise<IteratorResult<Chunk>>; stop(reason?: unknown): unknown };

const RULED = new WeakSet<Response>();

const isRaw = (body: object) =>
  body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof Blob || body instanceof FormData || body instanceof URLSearchParams;

const isIterable = (body: object): body is AsyncIterable<Chunk> => Symbol.asyncIterator in body;

function sourceOf(body: ReadableStream<Chunk> | AsyncIterable<Chunk>): Source {
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    return { next: () => reader.read() as Promise<IteratorResult<Chunk>>, stop: reason => reader.cancel(reason) };
  }

  const iterator = body[Symbol.asyncIterator]();
  return { next: () => iterator.next(), stop: reason => iterator.return?.(reason) };
}

function json(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, item) {
    const raw = this[key];

    if (typeof item == "bigint") throw new TypeError("Cannot send a bigint - send its values, as a string or number.");

    if (raw instanceof Model || (typeof item == "object" && item !== null && !Array.isArray(item) && !isPlain(item)))
      throw new TypeError(`Cannot send ${(raw as object).constructor.name} - send its values.`);

    return item;
  });
}

const isPlain = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function toReply(args: unknown[], stream: (source: Source) => ReadableStream<Uint8Array>): Response {
  const [status, body] = typeof args[0] == "number" ? (args as [number, unknown]) : [undefined, args[0]];

  if (body instanceof Response) return body;
  if (typeof body == "function") throw new TypeError("Cannot send a function - return a fetch handler instead.");
  if (body === undefined) return ruled(null, status ?? 204);
  if (status === 204 || status === 304 || (status !== undefined && status < 200)) throw new RangeError(`A ${status} reply has no body.`);
  if (typeof body == "string") return ruled(body, status, "text/plain; charset=utf-8");
  if (body instanceof ReadableStream || (typeof body == "object" && body !== null && isIterable(body))) return ruled(stream(sourceOf(body as AsyncIterable<Chunk>)), status);
  if (typeof body == "object" && body !== null && isRaw(body)) return ruled(body as BodyInit, status);

  return ruled(json(body), status, "application/json; charset=utf-8");
}

function ruled(body: BodyInit | null, status = 200, type?: string): Response {
  const response = new Response(body, { status, headers: type ? { "content-type": type } : undefined });

  RULED.add(response);
  return response;
}

export function withHeaders(response: Response, extra?: Headers): Response {
  if (!extra || response.status < 200 || !hasAny(extra)) return response;

  const ruled = RULED.has(response);
  const headers = new Headers(response.headers);
  const sent = new Set(response.headers.getSetCookie());

  extra.forEach((value, name) => name === "set-cookie" || (!ruled && response.headers.has(name)) || headers.set(name, value));

  for (const cookie of extra.getSetCookie()) if (!sent.has(cookie)) headers.append("set-cookie", cookie);

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const hasAny = (headers: Headers) => !headers.keys().next().done;

export function refusal(error: unknown): Response {
  const json = (status: number, message: string, headers?: Record<string, string>) =>
    new Response(JSON.stringify({ message }), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });

  if (error instanceof Redirect) return json(error.status, error.message, { location: error.location });
  if (error instanceof HttpError && error.status >= 400 && error.status < 600) return json(error.status, error.message);

  console.error(error);
  return json(500, "Internal error.");
}
