import { createHash } from "node:crypto";
import { basename, dirname, relative, sep } from "node:path";

import type { Exports } from "../call";
import { RESERVED, type Tree as CallTree } from "../route";
import type { ErrorClass, Parent } from "./scan";
import type { Leaf, Tree } from "./surface";

export const SCRIPT = /\.[cm]?[jt]sx?$/;

export interface Located {
  file: string;
  pattern: string[];
  module: string;
}

export interface Exposed extends Located {
  calls: string[];
  errors: ErrorClass[];
}

export type Locate = (file: string) => Located | undefined;

export interface Stub {
  from?: string;
  at?: unknown;
  lines?: string[];
}

export function locate(dir: string, file: string): Located | undefined {
  if (!file.startsWith(dir + sep) || !SCRIPT.test(file)) return;

  const pattern = relative(dir, file).split(sep);
  const name = pattern.pop()!.replace(SCRIPT, "");
  const dynamic = pattern.find(part => /^\[.*\]$/.test(part));

  if (dynamic) throw new Error(`${relative(dirname(dir), file)} is under ${dynamic} - folders are static path segments.`);

  return { file, pattern, module: name === "index" ? "" : name };
}

export const pathOf = ({ pattern }: Located) => "/" + pattern.join("/");

const localId = ({ module }: Located, name: string) => (module ? `${module}:${name}` : name);
const globalId = (at: Located, name: string) => `${pathOf(at)}#${localId(at, name)}`;

export class Manifest<E extends Exposed = Exposed> {
  readonly modules = new Map<string, E>();

  constructor(readonly salt?: string) {}

  callId(at: Located, name: string): string {
    return this.salt ? this.seal(globalId(at, name)) : localId(at, name);
  }

  classId(at: Located, name: string): string {
    return this.seal(globalId(at, name));
  }

  parentId(parent: Parent, locate: Locate): string {
    return "id" in parent ? parent.id : this.classId(locate(parent.file)!, parent.name);
  }

  stub(exposed: E, locate: Locate, { from = "@expressive/rpc", at = pathOf(exposed), lines = [] }: Stub = {}): string {
    const json = JSON.stringify;

    return [
      `import { call, define } from ${json(from)};`,
      ...this.parentImports(exposed),
      `const at = ${json(at)};`,
      ...exposed.calls.map(name => `export const ${name} = (...args) => call(at, ${json(this.callId(exposed, name))}, args);`),
      ...this.errorLines(exposed, locate),
      ...lines,
      "",
    ].join("\n");
  }

  protected parentImports(exposed: E): string[] {
    const before = new Set<string>();

    for (const { parent } of exposed.errors)
      if (parent && "file" in parent && parent.file !== exposed.file) before.add(importOf(exposed.file, parent.file));

    return [...before].map(spec => `import ${JSON.stringify(spec)};`);
  }

  protected errorLines(exposed: E, locate: Locate): string[] {
    const json = JSON.stringify;

    return exposed.errors.map(({ name, parent }) => {
      const args = [json(this.classId(exposed, name)), json(name), ...(parent ? [json(this.parentId(parent, locate))] : [])];
      return `export const ${name} = define(${args.join(", ")});`;
    });
  }

  protected seal(id: string): string {
    return this.salt ? createHash("sha256").update(this.salt + id).digest("base64url").slice(0, 16) : id;
  }
}

function importOf(from: string, file: string): string {
  const rel = relative(dirname(from), file).replaceAll("\\", "/");
  return rel.startsWith(".") ? rel : "./" + rel;
}

export function groupLines(file: string, tree: Tree): string[] {
  const json = JSON.stringify;
  const imports = new Map<string, Map<string, string>>();
  const groups: string[] = [];
  let count = 0;

  const render = (node: Tree | Leaf): string => {
    if (node instanceof Map) return node.size ? `{ ${[...node].map(([key, child]) => `${json(key)}: ${render(child)}`).join(", ")} }` : "{}";

    const names = imports.get(node.file) ?? imports.set(node.file, new Map()).get(node.file)!;
    return names.get(node.name) ?? names.set(node.name, `t${count++}`).get(node.name)!;
  };

  const exports = [...tree].map(([key, entry]) => {
    if (!(entry instanceof Map)) return `${render(entry)} as ${json(key)}`;

    groups.push(`const g${groups.length} = ${render(entry)};`);
    return `g${groups.length - 1} as ${json(key)}`;
  });

  return [
    ...[...imports].map(([from, names]) => `import { ${[...names].map(([name, alias]) => `${name} as ${alias}`).join(", ")} } from ${json(importOf(file, from))};`),
    ...groups,
    `export { ${exports.join(", ")} };`,
  ];
}

export const addressOf = ({ pattern, module }: Located): string[] => (module ? [...pattern, module] : pattern);

const labelOf = ({ pattern, file }: Located) => [...pattern, basename(file)].join("/");

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const member = (key: string) => (IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`);

export interface Layer<G> {
  gate?: G;
  module?: Exposed;
  calls: Map<string, { exposed: Exposed; name: string }>;
  children: Map<string, Layer<G>>;
}

type Load = (file: string) => Promise<Record<string, unknown>>;
type Route = (gate: never, children: CallTree) => CallTree;

export class Calls extends Manifest {
  callId(at: Located, name: string): string {
    return this.salt ? this.seal(`/${addressOf(at).join("/")}#${name}`) : name;
  }

  classId(_at: Located, name: string): string {
    return name;
  }

  stub(exposed: Exposed, locate: Locate, { from = "@expressive/rpc", at = pathOf(exposed), lines = [] }: Stub = {}): string {
    this.check(exposed);

    const node = "api" + String(at).split("/").filter(Boolean).map(member).join("");

    return [
      `import { api, define } from ${JSON.stringify(from)};`,
      ...this.parentImports(exposed),
      `const at = ${node};`,
      ...exposed.calls.map(name => `export const ${name} = at${member(this.callId(exposed, name))};`),
      ...this.errorLines(exposed, locate),
      ...lines,
      "",
    ].join("\n");
  }

  check(exposed: Exposed) {
    const taken = [...addressOf(exposed), ...exposed.calls].find(name => RESERVED.has(name));

    if (taken) throw new Error(`${labelOf(exposed)}: "${taken}" is reserved for the client - name it otherwise.`);

    for (const other of this.modules.values()) {
      if (other.file === exposed.file) continue;

      const clash = exposed.errors.find(({ name }) => other.errors.some(error => error.name === name));

      if (clash) throw new Error(`${labelOf(exposed)} and ${labelOf(other)} both export an error class ${clash.name} - rename one where it is exported.`);
    }
  }

  layout<G>(gates: Map<string, G>): Layer<G> {
    const root: Layer<G> = { gate: gates.get(""), calls: new Map(), children: new Map() };

    const child = (layer: Layer<G>, key: string, path: string[], module?: Exposed): Layer<G> => {
      const found = layer.children.get(key);
      const clash = found && (found.module ?? module);

      if (clash) throw new Error(`/${path.join("/")} is both ${key}/ and ${labelOf(clash)} - rename one.`);
      if (found) return found;

      const made: Layer<G> = { gate: module ? undefined : gates.get(path.join("/")), module, calls: new Map(), children: new Map() };

      layer.children.set(key, made);

      return made;
    };

    for (const exposed of this.modules.values()) {
      this.check(exposed);

      let layer = root;

      exposed.pattern.forEach((part, i) => (layer = child(layer, part, exposed.pattern.slice(0, i + 1))));

      if (exposed.module) layer = child(layer, exposed.module, addressOf(exposed), exposed);

      for (const name of exposed.calls) layer.calls.set(this.callId(exposed, name), { exposed, name });
    }

    const clashes = (layer: Layer<G>, path: string[]) => {
      for (const [key, sub] of layer.children) {
        const call = layer.calls.get(key);

        if (call) throw new Error(`${labelOf(call.exposed)}: ${call.name}() and /${[...path, key].join("/")} share a name - rename one.`);

        clashes(sub, [...path, key]);
      }
    };

    clashes(root, []);

    return root;
  }

  source(gates: Located[], base = ""): string {
    const json = JSON.stringify;
    const layout = this.layout(new Map(gates.map(gate => [gate.pattern.join("/"), gate])));
    const modules = [...this.modules.values()];
    const files = [...new Set([...modules.map(exposed => exposed.file), ...gates.map(gate => gate.file)])];
    const alias = (file: string) => `m${files.indexOf(file)}`;

    const render = (layer: Layer<Located>, indent: string): string => {
      const inner = indent + "  ";
      const entries = [
        ...[...layer.calls].map(([id, { exposed, name }]) => `${inner}${json(id)}: ${alias(exposed.file)}.${name},`),
        ...[...layer.children].map(([key, sub]) => `${inner}${json(key)}: ${render(sub, inner)},`),
      ];
      const body = entries.length ? `{\n${entries.join("\n")}\n${indent}}` : "{}";

      return layer.gate ? `route(${alias(layer.gate.file)}.default, ${body})` : body;
    };

    const errors = modules.filter(exposed => exposed.errors.length);

    return [
      `import { install, verify } from "@expressive/rpc/protocol";`,
      `import { handler, route } from "@expressive/rpc/http";`,
      ...files.map(file => `import * as ${alias(file)} from ${json(file)};`),
      "",
      "install();",
      "",
      ...errors.map(exposed => `verify(${json(labelOf(exposed))}, { calls: {}, classes: { ${exposed.errors.map(({ name }) => `${json(name)}: ${alias(exposed.file)}.${name}`).join(", ")} } });`),
      `const errors = { ${errors.flatMap(exposed => exposed.errors.map(({ name }) => `${json(name)}: ${alias(exposed.file)}.${name}`)).join(", ")} };`,
      "",
      `const api = ${render(layout, "")};`,
      "",
      `export const handle = handler(api, { errors${base ? `, base: ${json(base)}` : ""} });`,
      "",
    ].join("\n");
  }

  async build(gates: Map<string, () => Promise<unknown>>, load: Load, route: Route, verify: (file: string, exports: Exports) => void) {
    const layout = this.layout(gates);
    const errors: Record<string, unknown> = {};

    const make = async (layer: Layer<() => Promise<unknown>>): Promise<CallTree> => {
      const tree: CallTree = {};

      for (const [id, { exposed, name }] of layer.calls) tree[id] = (await load(exposed.file))[name] as CallTree[string];
      for (const [key, sub] of layer.children) tree[key] = await make(sub);

      return layer.gate ? route((await layer.gate()) as never, tree) : tree;
    };

    for (const exposed of this.modules.values()) {
      const module = await load(exposed.file);
      const classes = Object.fromEntries(exposed.errors.map(({ name }) => [name, module[name]]));

      verify(exposed.file, { calls: {}, classes });
      Object.assign(errors, classes);
    }

    return { tree: await make(layout), errors };
  }
}
