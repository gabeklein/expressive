import { randomBytes } from "node:crypto";
import type { Model } from "@expressive/mvc";
import { listener } from "@expressive/mvc/observable";

interface Tracker {
  generation: string;
  counter: number;
  dirty: boolean;
  keys: Map<string, number>;
  watchers: Set<() => void>;
  mark(key: string): () => void;
  collections: Set<string>;
}

const trackers = new WeakMap<Model, Tracker>();

export function track(instance: Model): void {
  if (trackers.has(instance)) return;

  const settle = () => {
    tracker.dirty = false;
    tracker.watchers.forEach(watcher => watcher());
  };
  const tracker: Tracker = {
    generation: randomBytes(6).toString("base64url"),
    counter: 0,
    dirty: false,
    keys: new Map(),
    watchers: new Set(),
    collections: new Set(),
    mark(key) {
      if (!tracker.dirty) {
        tracker.counter++;
        tracker.dirty = true;
      }

      tracker.keys.set(key, tracker.counter);
      return settle;
    },
  };

  trackers.set(instance, tracker);
  instance.set(key => (typeof key == "string" ? tracker.mark(key) : undefined));
}

export function idOf(instance: Model): string {
  track(instance);
  return trackers.get(instance)!.generation;
}

export function collect(instance: Model, field: string, collection: object): void {
  const tracker = trackers.get(instance)!;

  if (tracker.collections.has(field)) return;

  tracker.collections.add(field);
  listener(collection, key => (typeof key == "boolean" || key === null ? undefined : tracker.mark(field)));
}

export function watch(instance: Model, watcher: () => void): () => void {
  const { watchers } = trackers.get(instance)!;

  watchers.add(watcher);

  return () => watchers.delete(watcher);
}

export function versionOf(instance: Model): string {
  const { generation, counter } = trackers.get(instance)!;
  return `${generation}:${counter}`;
}

export function changedSince(instance: Model, version: string | undefined, fields: string[]): string[] {
  const tracker = trackers.get(instance)!;
  const [generation, counter] = version?.split(":") ?? [];

  if (generation !== tracker.generation) return fields;

  const since = Number(counter);
  return fields.filter(field => (tracker.keys.get(field) ?? 0) > since);
}

export function snapshot(instance: Model, fields: string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, read(instance, field)]));
}

function read(instance: Model, field: string): unknown {
  try {
    return (instance as any)[field];
  } catch (error) {
    if (!(error instanceof Promise)) throw error;

    error.catch(() => {});
    return { $pending: true };
  }
}
