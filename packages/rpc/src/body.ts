import { BadRequest, HttpError, PayloadTooLarge } from "./errors";

const LIMIT = 1 << 20;

class Buffered extends Request {
  constructor(
    readonly origin: Request,
    private read: () => Promise<Uint8Array>,
  ) {
    const body = origin.body && new ReadableStream<Uint8Array>({
      async pull(controller) {
        const bytes = await read();

        if (bytes.length) controller.enqueue(bytes.slice());
        controller.close();
      },
    });

    super(origin.url, { method: origin.method, headers: origin.headers, body, signal: origin.signal, duplex: "half" } as RequestInit);
  }

  override async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return (await this.read()).slice();
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.bytes()).buffer;
  }

  override async text(): Promise<string> {
    return new TextDecoder().decode(await this.read());
  }

  override async json(): Promise<any> {
    return JSON.parse(await this.text());
  }

  override async blob(): Promise<Blob> {
    return new Blob([await this.bytes()], { type: this.headers.get("content-type") ?? "" });
  }

  override async formData(): Promise<FormData> {
    return new Response(await this.bytes(), { headers: this.headers }).formData();
  }

  override clone(): Request {
    return new Buffered(this.origin, this.read);
  }
}

const cache = new WeakMap<Request, Buffered>();

/** The request every read of `request`'s body goes through: buffered once, on the first read of any kind. */
export function bodyOf(request: Request): Request {
  if (request instanceof Buffered) return request;

  let buffered = cache.get(request);

  if (!buffered) {
    let bytes: Promise<Uint8Array> | undefined;
    const read = () => (bytes ??= request.arrayBuffer().then(buffer => new Uint8Array(buffer)));

    cache.set(request, (buffered = new Buffered(request, read)));
  }

  return buffered;
}

/** The request a scope keys its maps on - the one the host passed. */
export function originOf(request: Request): Request {
  return request instanceof Buffered ? request.origin : request;
}

export async function capped(request: Request): Promise<string> {
  const length = Number(request.headers.get("content-length"));

  if (length > LIMIT) throw new PayloadTooLarge("The body is over 1 MB.");

  const bytes = await request.bytes();

  if (bytes.length > LIMIT) throw new PayloadTooLarge("The body is over 1 MB.");

  return new TextDecoder().decode(bytes);
}

const isJson = (type: string) => {
  const media = type.split(";")[0].trim().toLowerCase();
  return media === "application/json" || media.endsWith("+json");
};

export async function parsed(request: Request, check?: (value: unknown) => unknown): Promise<unknown> {
  const text = await capped(request);
  let value: unknown;

  if (text) {
    if (!isJson(request.headers.get("content-type") ?? "")) throw new BadRequest("Expected a JSON body.");

    try {
      value = JSON.parse(text);
    } catch {
      throw new BadRequest("The body is not valid JSON.");
    }
  }

  if (!check) return value;

  try {
    return await check(value);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new BadRequest(error instanceof Error ? error.message : String(error));
  }
}
