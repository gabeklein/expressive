import { isCodec, parse, stringify } from "./codec";
import { registry } from "./registry";
import { ERRORS, HttpError } from "./errors";

export {
  BadRequest,
  Conflict,
  Forbidden,
  Gone,
  HttpError,
  InternalError,
  MethodNotAllowed,
  NotFound,
  NotImplemented,
  PayloadTooLarge,
  PaymentRequired,
  Redirect,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
} from "./errors";

const ABSOLUTE = /^[a-z][a-z\d+.-]*:/i;

export type Transport = (request: Request) => Promise<Response>;

export interface ClientOptions {
  base?: string;
  transport?: Transport;
  headers?(): Record<string, string>;
  reply?(res: Response): Promise<void>;
  /** Error classes the server may throw, by id - one thrown arrives as that class. */
  errors?: Record<string, new (message: string) => Error>;
}

/** For the calls under a node: `signal` aborts them, `timeout` (ms) fails them with a `TimeoutError`. */
export interface CallOptions {
  signal?: AbortSignal;
  timeout?: number;
}

type Call = (...args: any[]) => unknown;

/** The client side of a server's tree: each call returns a Promise, and any node takes `.with()`. */
export type Remote<T> = 0 extends 1 & T ? any : (T extends Call ? (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> : { [K in keyof T]: Remote<T[K]> }) & {
  /** This node with `signal` or `timeout` for the calls under it - nested, the inner extend the outer. */
  with(options: CallOptions): Remote<T>;
};

export function client<T = any>(initial: ClientOptions = {}) {
  const options = { ...initial };
  const { add, define, rebuild } = registry({ ...ERRORS, ...initial.errors });

  function configure(next: ClientOptions): void {
    Object.assign(options, next);

    if (next.errors) add(next.errors);
  }

  async function send(path: string, headers: Record<string, string>, body: unknown, { signal, timeout }: CallOptions = {}): Promise<any> {
    const { base = "", transport } = options;
    const url = base + path;

    if (!ABSOLUTE.test(url) && !globalThis.location)
      throw new Error(`Cannot send to ${url} - a relative base needs a page location to resolve against. Pass an absolute base: configure({ base: "https://api.example.com" }).`);

    const signals = [signal, timeout === undefined ? undefined : AbortSignal.timeout(timeout)].filter(s => s !== undefined);
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers?.(), ...headers },
      body: stringify(body),
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    };
    const res = await (transport ? transport(new Request(new URL(url, globalThis.location?.href), init)) : fetch(url, init));

    await options.reply?.(res);

    return settle(res);
  }

  async function settle(res: Response): Promise<any> {
    if (!isCodec(res))
      throw Object.assign(new HttpError(await res.text()), { status: res.status });

    const body = parse(await res.text()) as any;

    if (res.ok) return body;

    throw rebuild(body);
  }

  async function call(path: string, name: string, args: unknown[], options?: CallOptions): Promise<unknown> {
    const reply = await send(path, { "x-expressive-call": name }, args, options);

    return reply.value;
  }

  function node(path: string[], scope: CallOptions): any {
    const children = new Map<string, unknown>();
    const run = (...args: unknown[]) => {
      if (!path.length) throw new Error("The client's root is not a call - name one: api.list().");

      return call("/" + path.slice(0, -1).join("/"), path.at(-1)!, args, scope);
    };

    return new Proxy(run, {
      get(_, key) {
        if (typeof key == "symbol" || key === "then") return;
        if (key === "with") return (next: CallOptions) => node(path, { ...scope, ...next });
        if (!children.has(key)) children.set(key, node([...path, key], scope));

        return children.get(key);
      },
    });
  }

  const api: Remote<T> = node([], {});

  return { api, call, configure, define };
}

export const { api, call, configure, define } = client();
