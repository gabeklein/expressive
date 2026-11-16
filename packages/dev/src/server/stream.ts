import { connect, listen, release } from "./connection";

export const STREAM = "/.expressive/stream";

export function isStream(request: Request): boolean {
  return (request.method === "GET" || request.method === "POST") && new URL(request.url).pathname === STREAM;
}

export function stream(request: Request): Response {
  const connection = connect(new URL(request.url).searchParams.get("connection"));

  if (!connection) return new Response(null, { status: 400 });

  if (request.method === "POST") {
    release(connection, request.headers.get("x-expressive-release"));
    return new Response(null, { status: 204 });
  }

  const encode = new TextEncoder();
  let close: (() => void) | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      close = listen(connection, (event, data) => controller.enqueue(encode.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)));

      request.signal.addEventListener("abort", () => {
        if (!close) return;
        close();
        close = undefined;
        controller.close();
      });
    },
    cancel() {
      close?.();
      close = undefined;
    },
  });

  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
