import { has, Model } from "@expressive/mvc";

import { construct, failure, inFolder, seated, seatsAlong, walkOf, within, type Call, type Endpoint as Base, type Exports as Plain, type Handle, type Incoming, type Seats } from "@expressive/rpc/protocol";
import { reply } from "@expressive/rpc/http";

import { begin, catchUp, connect, end, frameOf, hold, release, renew, twinOf, type Connection, type Shape } from "./connection";
import { idOf } from "./version";

export interface Exports extends Plain {
  seat?: Shape & { methods: Record<string, string> };
  pool?: Record<string, Pooled>;
}

export interface Pooled extends Shape {
  Type: Model.Type;
  methods: Record<string, string>;
}

export type Endpoint = Base<Exports>;

export const DETACHED = "/.expressive/detached";

export async function twins(incoming: Incoming<Exports>, fn?: Call): Promise<Handle | undefined> {
  const { request, list, at, exports, dev, seats } = incoming;
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const pull = header("x-expressive-get");
  const name = header("x-expressive-call")!;
  const method = exports?.seat && Object.hasOwn(exports.seat.methods, name) ? exports.seat.methods[name] : undefined;
  const plain = method ? undefined : fn;
  const seatPull = pull === "default" && !!exports?.seat;
  const pooled = plain || method || seatPull ? undefined : await pooledOf(list, pull, name);

  if (!pooled && !(plain || method || seatPull)) return;

  return async args => {
    const connection = connect(header("x-expressive-connection"));

    if (!connection) return reply(400, { message: "Expected an x-expressive-connection id." });

    const epoch = () => ({ "x-expressive-epoch": connection.epoch });

    release(connection, header("x-expressive-release"));

    const twin = pull || method || pooled ? twinOf(header("x-expressive-twin")) : undefined;

    if ((pull || method || pooled) && !twin) return reply(400, { message: "Expected an x-expressive-twin id." }, epoch());

    const held = twin ? connection.twins.get(twin) : undefined;
    const mismatch = pooled ? held && held.pool?.id !== pooled.id || pooled.method && !held : held?.pool;

    if (mismatch) return reply(404, { message: "Not found." }, epoch());

    const since = header("if-none-match");
    const items = header("x-expressive-items")?.split(",") ?? [];

    if (!pull) begin(connection);

    try {
      const result = pooled
        ? await inPool(request, connection, pooled, twin!, since, args, items, list, seats, at)
        : await atFolder(incoming, connection, { pull, method, fn: plain, twin, since, args, items });

      return result ? reply(200, result, epoch()) : reply(304, undefined, epoch());
    } catch (error) {
      if (error instanceof Moved) return reply(409, { message: error.message }, epoch());

      return failure(error, list, dev, epoch());
    } finally {
      if (!pull) end(connection);
    }
  };
}

class Moved extends Error {
  message = "This twin's context was replaced - its instance is gone.";
}

interface Invocation {
  pull?: string;
  method?: string;
  fn?: Call;
  twin?: string;
  since?: string;
  args: unknown[];
  items: string[];
}

async function atFolder(incoming: Incoming<Exports>, connection: Connection, invocation: Invocation) {
  const { pull, method, fn, twin, since, args, items } = invocation;
  const { pathname, exports } = incoming;
  const shape = exports!.seat ?? { fields: [] };

  return inFolder(incoming, async () => {
    const seat = seated();

    if (seat) renew(connection, pathname, seat);
    if (twin) hold(connection, twin, pathname, seat!, shape, since);
    if (pull) return caughtUp(connection, twin!);

    const value = await (method ? invoke(seat!, method, args, items) : fn!(...args));

    return { value, frame: frameOf(connection) };
  });
}

interface Target extends Pooled {
  id: string;
  method?: string;
}

async function inPool(request: Request, connection: Connection, target: Target, twin: string, since: string | undefined, args: unknown[], items: string[], list: Endpoint[], seats: Seats, at: string[]) {
  const off = "/" + at.join("/") === DETACHED;
  const walk = off ? { segments: [], pattern: [] } : walkOf(list, at);
  const along = off ? [] : await seatsAlong(seats, walk.pattern);
  const address = "/" + at.join("/");

  return within(request, walk.segments, async () => {
    const held = connection.twins.get(twin);

    if (held && !held.pool!.current()) {
      release(connection, twin);
      throw new Moved();
    }

    const built = held ? undefined : construct(target.Type, off);
    const instance = held ? held.instance : built!.instance;

    hold(connection, twin, address, instance, target, since, held?.pool ?? { id: target.id, drop: built!.drop, current: built!.current });

    if (!target.method) return caughtUp(connection, twin);

    const value = await invoke(instance, target.method, args, items);

    return { value, frame: frameOf(connection) };
  }, along);
}

function caughtUp(connection: Connection, twin: string) {
  const frame = catchUp(connection, twin);
  return Object.keys(frame).length ? { frame } : undefined;
}

function invoke(instance: Model, method: string, args: unknown[], items: string[]): unknown {
  const path = method.split(".");
  const name = path.pop()!;
  const ids = [...items];
  let target: unknown = instance;

  for (const field of path) {
    target = (target as any)[field];

    if (target instanceof has.Pool) {
      const id = ids.shift();
      target = target.get(item => item instanceof Model && idOf(item) === id);
    }
  }

  if (!(target instanceof Model)) throw new Error(`${path.join(".")} is not set on ${instance}.`);

  return (target as any)[name](...args);
}

async function pooledOf(list: Endpoint[], pull: string | undefined, name: string): Promise<Target | undefined> {
  for (const endpoint of list) {
    const pool = (await endpoint.exports()).pool ?? {};

    if (pull) {
      if (Object.hasOwn(pool, pull)) return { id: pull, ...pool[pull] };
      continue;
    }

    for (const [id, entry] of Object.entries(pool))
      if (Object.hasOwn(entry.methods, name)) return { id, ...entry, method: entry.methods[name] };
  }
}
