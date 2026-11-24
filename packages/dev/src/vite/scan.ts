import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { init, parse } from "es-module-lexer";
import { parseAst, transformWithOxc, type ESTree } from "vite";
import * as root from "@expressive/rpc";
import { isClass, moduleOf, scanModule, type Module, type Scan, type Sources, type Value } from "@expressive/rpc/vite";

import type { ExportScanner, Remote } from "./routes";

export const scanExports: ExportScanner = async (source, path) => {
  const { code } = await transformWithOxc(source, path, { jsx: { runtime: "automatic" } });

  await init;

  const entries = parse(code)[1];
  const entry = entries.find(entry => entry.n === "default");
  const local = entry && (entry.ln ?? /^\s+([\w$]+)\s*(?:;|$)/m.exec(code.slice(entry.e))?.[1]);
  const classDefault = local
    ? new RegExp(`\\bclass\\s+${local}\\b`).test(code)
    : /\bexport\s+default\s+(abstract\s+)?class\b/.test(code);

  const label = labelOf(code, entries.find(entry => entry.n === "label")?.ln);

  return { exports: entries.map(entry => entry.n), classDefault, label };
};

function labelOf(code: string, local: string | undefined): string | undefined {
  if (!local) return;

  for (const node of parseAst(code).body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (decl?.type !== "VariableDeclaration" || decl.kind !== "const") continue;

    for (const { id, init } of decl.declarations)
      if (id.type === "Identifier" && id.name === local)
        return init!.type === "Literal" && typeof init!.value == "string" ? init!.value : undefined;
  }
}

export async function scanRemote(remote: Remote, source: string, sources: Sources, locate: (file: string) => Remote | undefined): Promise<Scan> {
  let gate = false;

  const owned = (file: string) => {
    const other = locate(file);
    return !!other && (remote.folder + sep).startsWith(other.folder + sep);
  };

  const scan = await scanModule(remote.file, source, sources, owned, {
    async default(value) {
      gate = isGate(value);
      return defaultProblems(remote, value, source, sources);
    },
  });

  return { ...scan, gate };
}

/** A remote entry's default alone - checked whether or not the client imports the entry. */
export async function scanGate(remote: Remote, source: string, sources: Sources): Promise<{ gate: boolean; problems: string[] }> {
  const { body, exports } = moduleOf(remote.file, source);

  if (body.some(isDefaultReexport)) return { gate: false, problems: ["A remote default is declared in the entry - a re-exported one is not checked or run as the folder's gate."] };
  if (!exports.has("default")) return { gate: false, problems: [] };

  const value = exports.get("default");

  return { gate: isGate(value), problems: await defaultProblems(remote, value, source, sources) };
}

const isGate = (value: Value): boolean => isClass(value) && !!value.superClass;

const isDefaultReexport = (node: Module["body"][number]) =>
  node.type === "ExportNamedDeclaration" && !!node.source && node.specifiers.some(({ exported }) => (exported.type === "Identifier" ? exported.name : exported.value) === "default");

function defaultProblems(remote: Remote, value: Value, source: string, sources: Sources): Promise<string[]> | string[] {
  if (remote.module) return ["Only a folder's remote entry - remote.ts or remote/index.ts - may export a default."];
  if (!isGate(value)) return ["A remote default is its folder's gate - a Model subclass whose static key() admits each call."];

  return gateProblems(source, remote.file, sources);
}

export function hasGate(file: string): boolean {
  return isGate(moduleOf(file, readFileSync(file, "utf8")).exports.get("default"));
}

interface Found {
  cls: ESTree.Class;
  module: Module;
}

const LIBRARY = /^@expressive\//;
const ERRORS = "@expressive/rpc";

const isHttpError = (name: string) => {
  const Type = (root as Record<string, unknown>)[name];
  return typeof Type == "function" && Type.prototype instanceof Error;
};

export async function gateProblems(source: string, path: string, sources: Sources): Promise<string[]> {
  const module = declaredOf(path, source);
  const problems: string[] = [];
  const chain: Found[] = [];
  let at: Found | Base | undefined = { cls: module.exports.get("default") as ESTree.Class, module };

  while (at && "cls" in at) {
    const key = identity(at);
    const loop = chain.findIndex(found => identity(found) === key);

    if (loop >= 0) {
      const [first, ...rest] = chain.slice(loop).map(({ cls }) => cls.id?.name ?? "default");
      return [...problems, `${first} extends ${[...rest, first].join(", which extends ")} - a class cannot extend itself.`];
    }

    chain.push(at);
    at = await baseOf(at, sources, problems);
  }

  if (at?.global) problems.push(`${at.owner} extends ${at.global}, which is neither declared nor imported in ${module.file}.`);
  if (at?.error) problems.push(`${at.owner} extends ${at.error}, an error class - a folder's default must be a Model.`);

  return problems;
}

function identity({ cls, module }: Found): string {
  return `${module.file}#${cls.start}`;
}

interface Base {
  owner: string;
  global?: string;
  error?: string;
}

async function baseOf({ cls, module }: Found, sources: Sources, problems: string[]): Promise<Found | Base | undefined> {
  const base = cls.superClass;
  const owner = cls.id?.name ?? "default";

  if (!base) return void problems.push(`${owner} extends no class - a folder's default must be a Model.`);

  if (base.type !== "Identifier")
    return void problems.push(`${owner} extends an expression - name its base class.`);

  const local = module.locals.get(base.name);

  if (isClass(local)) return { cls: local, module };

  const imported = module.imports.get(base.name);

  if (!imported || imported.type) return { owner, global: base.name };
  if (imported.from === ERRORS && isHttpError(imported.name)) return { owner, error: base.name };
  if (LIBRARY.test(imported.from)) return { owner };

  const file = await sources.resolve(imported.from, module.file);

  if (!file) return void problems.push(`${owner} extends ${base.name} from "${imported.from}", which does not resolve.`);

  const typed = declarations(file, sources);
  const next = declaredOf(typed, sources.read(typed));
  const exported = next.exports.get(imported.name);

  if (!isClass(exported)) return void problems.push(`${owner} extends ${base.name}, which ${typed} does not export as a class.`);

  return { cls: exported, module: next };
}

function declarations(file: string, sources: Sources): string {
  const typed = file.replace(/\.([cm]?)js$/, ".d.$1ts");

  if (typed === file) return file;

  try {
    sources.read(typed);
    return typed;
  } catch {
    return file;
  }
}

function declaredOf(file: string, source: string): Module {
  const module = moduleOf(file, source);

  for (const node of module.body)
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "ClassDeclaration" && node.declaration.id)
      module.exports.set(node.declaration.id.name, node.declaration);

  return module;
}
