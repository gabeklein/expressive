import { within, type Gate, type Seat } from "./context";

export interface Exports {
  calls: Record<string, unknown>;
  classes: Record<string, unknown>;
}

export interface Endpoint<E extends Exports = Exports> {
  pattern: string[];
  exports(): Promise<E>;
}

interface Match<E extends Exports = Exports> {
  endpoint: Endpoint<E>;
  segments: string[];
}

function match(pattern: string[], at: string[]): string[] | undefined {
  if (pattern.at(-1) !== "*" && pattern.length !== at.length) return;

  const segments: string[] = [];

  for (const [i, part] of pattern.entries()) {
    if (part === "*") {
      segments.push(at.slice(i).join("/"));
      continue;
    }

    if (at[i] === undefined) return;
    if (!part.startsWith(":") && part !== at[i]) return;

    segments.push(at[i]);
  }

  return segments;
}

const rank = (part: string) => (part === "*" ? 0 : part.startsWith(":") ? 1 : 2);
const specificity = (pattern: string[]) => pattern.map(rank).join("") + "3";

function resolve<E extends Exports>(endpoints: Endpoint<E>[], at: string[]): Match<E> | undefined {
  const matches: Match<E>[] = [];

  for (const endpoint of endpoints) {
    const segments = match(endpoint.pattern, at);
    if (segments) matches.push({ endpoint, segments });
  }

  return matches.sort((a, b) => specificity(b.endpoint.pattern).localeCompare(specificity(a.endpoint.pattern)))[0];
}

type Call = (...args: unknown[]) => unknown;

export type Seats = (pattern: string[]) => Promise<Seat | Gate | undefined>;

export interface Fault {
  error?: string;
  message: string;
  stack?: string;
  [field: string]: unknown;
}

export type Outcome = { value: unknown } | { error: Fault; status?: number };

interface Located<E extends Exports = Exports> {
  found?: Match<E>;
  fn?: Call;
}

interface Folder {
  request: Request;
  found?: Match;
  seats: Seats;
}

export async function locate<E extends Exports>(list: Endpoint<E>[], at: string[], name?: string): Promise<Located<E>> {
  const found = resolve(list, at);
  const exports = found && await found.endpoint.exports();
  const fn = exports && name !== undefined ? callOf(exports, name) : undefined;

  return { found, fn };
}

export async function attempt(run: () => unknown, endpoints: Endpoint[], dev: boolean, errors?: Record<string, unknown>): Promise<Outcome> {
  try {
    return { value: await run() };
  } catch (error) {
    return fault(error, endpoints, dev, errors);
  }
}

/** `within` along the folder `found` names, its seats and gates from `seats`. */
export async function inFolder<T>({ request, found, seats }: Folder, run: () => T, fail?: (error: unknown) => Awaited<T> | Promise<Awaited<T>>): Promise<Awaited<T>> {
  const { endpoint, segments } = found!;
  const along = await seatsAlong(seats, endpoint.pattern);

  const depths = along.map((_, i) => paramsOf(endpoint.pattern.slice(0, i), segments));

  return within(request, segments, run, along, fail, paramsOf(endpoint.pattern, segments), depths);
}

function paramsOf(pattern: string[], segments: string[]): Record<string, string> {
  const params: Record<string, string> = {};

  pattern.forEach((part, i) => {
    if (part === "*") params["*"] = decode(segments[i]);
    else if (part.startsWith(":")) params[part.slice(1)] = decode(segments[i]);
  });

  return params;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function seatsAlong(seats: Seats, pattern: string[]): Promise<(Seat | Gate | undefined)[]> {
  return Promise.all(Array.from({ length: pattern.length + 1 }, (_, i) => seats(pattern.slice(0, i))));
}

function callOf({ calls }: Exports, name: string): Call | undefined {
  const fn = Object.hasOwn(calls, name) ? calls[name] : undefined;

  return typeof fn === "function" ? (fn as Call) : undefined;
}

export async function fault(error: unknown, endpoints: Endpoint[], dev: boolean, errors?: Record<string, unknown>): Promise<{ error: Fault; status?: number }> {
  if (!(error instanceof Error)) return { error: { message: "Internal error." } };

  const id = await classId(endpoints, error, errors);
  const { status } = error as { status?: unknown };

  if (id) return { error: { ...error, error: id, message: error.message }, status: typeof status == "number" ? status : undefined };
  if (!dev) return { error: { message: "Internal error." } };

  warn(error);

  return { error: { message: error.message, stack: error.stack } };
}

const warned = new WeakSet<Function>();

function warn({ constructor: Type }: Error) {
  const builtin = (globalThis as Record<string, unknown>)[Type.name] === Type;

  if (builtin || warned.has(Type)) return;

  warned.add(Type);
  console.warn(`${Type.name} is not a known error class, so a build replies "Internal error." for it - export it from a module the client calls, or list it in errors.`);
}

async function classId(endpoints: Endpoint[], error: Error, errors: Record<string, unknown> = {}): Promise<string | undefined> {
  const ids = new Map<unknown, string>();

  for (const { exports } of endpoints)
    for (const [id, Type] of Object.entries((await exports()).classes)) ids.set(Type, id);

  for (const [id, Type] of Object.entries(errors)) ids.set(Type, id);

  for (let proto = Object.getPrototypeOf(error); proto; proto = Object.getPrototypeOf(proto))
    if (ids.has(proto.constructor)) return ids.get(proto.constructor);
}

export function verify(path: string, { classes }: Exports): void {
  for (const [id, Type] of Object.entries(classes)) {
    const isError = typeof Type == "function" && Type.prototype instanceof Error;
    const name = typeof Type == "function" ? Type.name : id;

    if (!isError) throw new Error(`${path} exports ${name}, which is neither an async function nor an Error subclass.`);
  }
}
