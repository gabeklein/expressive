import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { init, parse } from "es-module-lexer";
import { parseAst, transformWithOxc } from "vite";
import { moduleOf, scanModule, type Module, type Scan, type Sources, type Value } from "@expressive/rpc/vite";

import type { ExportScanner, Remote } from "./routes";

export const scanExports: ExportScanner = async (source, path) => {
  const { code } = await transformWithOxc(source, path, { jsx: { runtime: "automatic" } });

  await init;

  const entries = parse(code)[1];
  const value = moduleOf(path, source).exports.get("default");
  const classDefault = entries.some(entry => entry.n === "default") ? kindOf(value) : false;
  const routeParameter = !!value && "params" in value && Array.isArray(value.params) && value.params[0]?.type === "Identifier" && value.params[0].name === "route";

  const label = labelOf(code, entries.find(entry => entry.n === "label")?.ln);

  return { exports: entries.map(entry => entry.n), classDefault, label, routeParameter };
};

function kindOf(value: Value): boolean | undefined {
  if (value?.type === "ClassDeclaration" || value?.type === "ClassExpression") return true;
  if (isGate(value)) return false;
}

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
      return defaultProblems(remote, value);
    },
  });

  return { ...scan, gate };
}

/** A remote entry's default alone - checked whether or not the client imports the entry. */
export function scanGate(remote: Remote, source: string): { gate: boolean; problems: string[] } {
  const { body, exports } = moduleOf(remote.file, source);

  if (body.some(isDefaultReexport)) return { gate: false, problems: ["A remote default is declared in the entry - a re-exported one is not checked or run as the folder's gate."] };
  if (!exports.has("default")) return { gate: false, problems: [] };

  const value = exports.get("default");

  return { gate: isGate(value), problems: defaultProblems(remote, value) };
}

const isGate = (value: Value): boolean =>
  value?.type === "FunctionDeclaration" || value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression";

const isDefaultReexport = (node: Module["body"][number]) =>
  node.type === "ExportNamedDeclaration" && !!node.source && node.specifiers.some(({ exported }) => (exported.type === "Identifier" ? exported.name : exported.value) === "default");

export const NOT_GATE = "A remote default is its folder's gate - a function that refuses by throwing or by activating a Model whose new() fails: export default () => { Session.new() }";

function defaultProblems(remote: Remote, value: Value): string[] {
  if (remote.module) return ["Only a folder's remote entry - remote.ts or remote/index.ts - may export a default."];
  if (!isGate(value)) return [NOT_GATE];

  return [];
}

export function hasGate(file: string): boolean {
  return isGate(moduleOf(file, readFileSync(file, "utf8")).exports.get("default"));
}
