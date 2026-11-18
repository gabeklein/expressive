import { randomBytes } from "node:crypto";
import { Model } from "@expressive/mvc";

import { changedSince, collect, idOf, snapshot, track, versionOf, watch } from "./version";

export interface Shape {
  fields: string[];
  children?: Record<string, Shape>;
  many?: true;
}

interface Held {
  address: string;
  instance: Model;
  shape: Shape;
  seen: Map<string, string>;
  watching: Map<string, { instance: Model; stop(): void }>;
  pool?: Pool;
  sent?: Map<string, Map<string, number>>;
}

interface Entry {
  key: string;
  path: string;
  instance: Model;
  shape: Shape;
}

export interface Pool {
  id: string;
  open?: true;
  drop(): void;
  current(): boolean;
}

export type Sink = (event: string, data: unknown) => void;

export interface Connection {
  id: string;
  epoch: string;
  twins: Map<string, Held>;
  sink?: Sink;
  busy: number;
  queued: boolean;
  scheduled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export type Frame = Record<string, { patch: Record<string, unknown>; version: string }>;

const TTL = 300;
const BEAT = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWIN = /^[\w$-]{1,80}$/;

const connections = new Map<string, Connection>();

const epochOf = () => randomBytes(6).toString("base64url");

let auditing = false;

export function audit(on: boolean): void {
  auditing = on;
}

export function connect(id: unknown): Connection | undefined {
  if (typeof id != "string" || !UUID.test(id)) return;

  let connection = connections.get(id);

  if (!connection) {
    connection = { id, epoch: epochOf(), twins: new Map(), busy: 0, queued: false, scheduled: false };
    connections.set(id, connection);
  }

  expire(connection);

  return connection;
}

function expire(connection: Connection): void {
  clearTimeout(connection.timer);

  if (connection.sink) return;

  connection.timer = setTimeout(() => {
    connections.delete(connection.id);
    release(connection, [...connection.twins.keys()].join(","));
  }, TTL * 1000);
  connection.timer.unref();
}

export function listen(connection: Connection, sink: Sink): () => void {
  const beat = setInterval(() => {
    sink("beat", { sum: checksum(connection) });
    if (auditing) drifted(connection);
  }, BEAT * 1000);

  beat.unref();
  connection.sink = sink;
  clearTimeout(connection.timer);
  sink("hello", { epoch: connection.epoch });
  announce(connection);

  return () => {
    clearInterval(beat);

    if (connection.sink !== sink) return;

    connection.sink = undefined;
    expire(connection);
  };
}

/** Release twins whose instance is gone and give their connections - or with `all`, every connection - a new epoch to rejoin under. */
export function rotate(all = false): void {
  for (const connection of connections.values()) {
    const dead = [...connection.twins].filter(([, held]) => held.instance.get(null)).map(([twin]) => twin);

    if (!all && !dead.length) continue;

    release(connection, dead.join(","));
    connection.epoch = epochOf();
    connection.sink?.("hello", { epoch: connection.epoch });
  }
}

export function counts(): { connections: number; twins: number; watchers: number } {
  let twins = 0;
  let watchers = 0;

  for (const connection of connections.values()) {
    twins += connection.twins.size;
    connection.twins.forEach(held => (watchers += held.watching.size));
  }

  return { connections: connections.size, twins, watchers };
}

export function begin(connection: Connection): void {
  connection.busy++;
}

export function end(connection: Connection): void {
  if (--connection.busy || !connection.queued) return;

  connection.queued = false;
  announce(connection);
}

function announce(connection: Connection): void {
  if (!connection.sink || connection.scheduled) return;

  connection.scheduled = true;
  queueMicrotask(() => {
    connection.scheduled = false;

    if (connection.busy) return void (connection.queued = true);

    const stale = staleOf(connection);
    if (Object.keys(stale).length) connection.sink?.("stale", stale);
  });
}

export function staleOf(connection: Connection): Record<string, string[]> {
  const stale: Record<string, string[]> = {};

  for (const [twin, held] of connection.twins) {
    follow(connection, twin);

    for (const { key, path, instance, shape } of entriesOf(twin, held)) {
      const seen = held.seen.get(path);
      const keys = seen ? changedSince(instance, seen, shape.fields) : [];

      if (keys.length) stale[key] = keys;
    }
  }

  return stale;
}

export function checksum(connection: Connection): number {
  let sum = 0;

  for (const [twin, { seen }] of connection.twins)
    for (const [path, version] of seen) sum = (sum ^ fnv(`${path ? `${twin}.${path}` : twin}@${version}`)) >>> 0;

  return sum;
}

function fnv(text: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);

  return hash >>> 0;
}

export function twinOf(id: unknown): string | undefined {
  return typeof id == "string" && TWIN.test(id) ? id : undefined;
}

export function release(connection: Connection, twins: unknown): void {
  if (typeof twins != "string") return;

  for (const twin of twins.split(",")) {
    const held = connection.twins.get(twin);

    if (held) unwatch(held);
    held?.pool?.drop();
    connection.twins.delete(twin);
  }
}

export function hold(connection: Connection, twin: string, address: string, instance: Model, shape: Shape, seen?: string, pool?: Pool): void {
  const held = connection.twins.get(twin);
  const keep = seen && held?.instance === instance;
  const kept = keep ? held!.seen : new Map<string, string>();
  const sent = auditing ? (keep && held!.sent) || new Map() : undefined;

  if (held) unwatch(held);
  if (seen) kept.set("", seen);

  connection.twins.set(twin, { address, instance, shape, seen: kept, watching: new Map(), pool, sent });
  follow(connection, twin);
}

export function renew(connection: Connection, address: string, instance: Model): void {
  for (const [twin, held] of connection.twins) {
    if (held.pool || held.address !== address || held.instance === instance) continue;

    held.instance = instance;
    follow(connection, twin);
  }
}

export function catchUp(connection: Connection, twin: string): Frame {
  const held = connection.twins.get(twin)!;
  const frame: Frame = {};

  follow(connection, twin);

  for (const { key, path, instance, shape } of entriesOf(twin, held)) {
    snapshot(instance, shape.fields);

    const seen = held.seen.get(path);
    const version = versionOf(instance);

    if (version === seen) continue;

    const patch = patchOf(instance, shape, changedSince(instance, seen, shape.fields));

    frame[key] = { patch, version };
    held.seen.set(path, version);
    if (held.sent) record(held.sent, path, patch, shape);
  }

  return frame;
}

export function frameOf(connection: Connection): Frame {
  const frame: Frame = {};

  for (const twin of connection.twins.keys()) Object.assign(frame, catchUp(connection, twin));

  return frame;
}

function entriesOf(twin: string, held: Held): Entry[] {
  const entries: Entry[] = [];

  (function walk(path: string, instance: Model, shape: Shape) {
    entries.push({ key: path ? `${twin}.${path}` : twin, path, instance, shape });

    for (const [field, child] of Object.entries(shape.children ?? {})) {
      const value = snapshot(instance, [field])[field];
      const at = path ? `${path}.${field}` : field;

      if (child.many) for (const [id, item] of membersOf(instance, field, value)) walk(`${at}.${id}`, item, child);
      else if (value instanceof Model) walk(at, value, child);
    }
  })("", held.instance, held.shape);

  return entries;
}

function follow(connection: Connection, twin: string): void {
  const held = connection.twins.get(twin)!;
  const live = new Set<string>();

  for (const { path, instance } of entriesOf(twin, held)) {
    live.add(path);
    if (held.watching.get(path)?.instance === instance) continue;

    held.watching.get(path)?.stop();
    track(instance);
    held.watching.set(path, { instance, stop: watch(instance, () => announce(connection)) });
  }

  for (const [path, { stop }] of held.watching)
    if (!live.has(path)) {
      stop();
      held.watching.delete(path);
      held.seen.delete(path);
    }
}

export function membersOf(owner: Model, field: string, pool: unknown): [string, Model][] {
  track(owner);
  collect(owner, field, pool as object);

  return [...(pool as Iterable<Model>)].map(item => [idOf(item), item]);
}

function unwatch(held: Held): void {
  held.watching.forEach(({ stop }) => stop());
  held.watching.clear();
}

function isPending(value: unknown): boolean {
  return (value as { $pending?: unknown } | null)?.$pending === true;
}

function patchOf(instance: Model, shape: Shape, keys: string[]): Record<string, unknown> {
  const patch = snapshot(instance, keys);

  for (const field of keys) {
    const child = patch[field];

    if (!shape.children?.[field]) continue;
    if (shape.children[field].many) patch[field] = { $items: membersOf(instance, field, child).map(([id]) => id) };
    else if (child instanceof Model) patch[field] = { $child: idOf(child) };
    else if (!isPending(child)) patch[field] = null;
  }

  return patch;
}

function record(sent: Map<string, Map<string, number>>, path: string, patch: Record<string, unknown>, shape: Shape): void {
  const fields = sent.get(path) ?? new Map<string, number>();

  sent.set(path, fields);

  for (const [field, value] of Object.entries(patch))
    if (shape.children?.[field] || isPending(value)) fields.delete(field);
    else fields.set(field, digest(() => value));
}

function drifted(connection: Connection): void {
  for (const [twin, held] of connection.twins)
    for (const { path, instance } of entriesOf(twin, held)) {
      const fields = held.sent?.get(path);
      const seen = held.seen.get(path);

      if (!fields) continue;

      const assigned = changedSince(instance, seen, [...fields.keys()]);

      for (const [field, hash] of fields) {
        if (assigned.includes(field)) continue;

        const now = digest(() => snapshot(instance, [field])[field]);

        if (now === hash) continue;

        fields.set(field, now);
        console.warn(`${instance.constructor.name}.${field} changed in place, so twins holding it are stale - assign a new value instead.`);
      }
    }
}

function digest(value: () => unknown): number {
  try {
    return fnv(JSON.stringify(value(), (_, item) => (item instanceof Map || item instanceof Set ? [...item] : typeof item == "bigint" ? `${item}` : item))!);
  } catch {
    return -1;
  }
}
