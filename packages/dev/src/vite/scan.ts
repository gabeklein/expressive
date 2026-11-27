import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { init, parse } from "es-module-lexer";
import { parseAst, transformWithOxc } from "vite";
import { isClass, moduleOf, scanModule, type Module, type Scan, type Sources, type Value } from "@expressive/rpc/vite";

import type { ExportScanner, Remote } from "./routes";

export const scanExports: ExportScanner = async (source, path) => {
  const { code } = await transformWithOxc(source, path, { jsx: { runtime: "automatic" } });

  await init;

  const entries = parse(code)[1];
  const value = moduleOf(path, source).exports.get("default");
  const classDefault = entries.some(entry => entry.n === "default") ? kindOf(value) : false;
  const modelDefault = (value?.type === "ClassDeclaration" || value?.type === "ClassExpression") && value.superClass?.type === "Identifier" && value.superClass.name === "Model";
  const routeParameter = !!value && "params" in value && Array.isArray(value.params) && value.params[0]?.type === "Identifier" && value.params[0].name === "route";

  const label = labelOf(code, entries.find(entry => entry.n === "label")?.ln);
  const dropsChildren = !modelDefault && drops(value);

  return { exports: entries.map(entry => entry.n), classDefault, modelDefault, label, routeParameter, dropsChildren };
};

type Node = { type: string; [key: string]: any };

function* walk(value: unknown, parent?: Node): Generator<[Node, Node | undefined]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item, parent);
    return;
  }

  if (!value || typeof value != "object") return;

  const node = value as Node;

  yield [node, parent];

  for (const key in node) yield* walk(node[key], node);
}

const CHILDREN = /^(children|arguments)$/;

const mentions = (body: unknown) => {
  for (const [node, parent] of walk(body)) {
    const bare = parent?.type !== "MemberExpression" || parent.object !== node;

    if (node.type === "Identifier" && CHILDREN.test(node.name)) return true;
    if (node.type === "Literal" && node.value === "children") return true;
    if (node.type === "Super") return true;
    if (node.type === "MemberExpression" && node.object.type === "ThisExpression" && node.property.name === "props" && bare) return true;
  }

  return false;
};

function ignores({ params: [first], body }: Node): boolean {
  const param = first?.type === "AssignmentPattern" ? first.left : first;

  if (mentions(body)) return false;
  if (!param) return true;
  if (param.type === "ObjectPattern") return !param.properties.some((prop: Node) => prop.type === "RestElement" || mentions(prop.key));
  if (param.type !== "Identifier") return false;

  for (const [node, parent] of walk(body))
    if (node.type === "Identifier" && node.name === param.name && !(parent?.type === "MemberExpression" && parent.object === node && !parent.computed))
      return false;

  return true;
}

function drops(value: Value): boolean {
  if (isGate(value)) return ignores(value as Node);
  if (!isClass(value)) return false;

  const render = (value.body.body as Node[]).find(member =>
    (member.type === "MethodDefinition" || member.type === "PropertyDefinition") && !member.computed && member.key.type === "Identifier" && member.key.name === "render");

  return !!render && isGate(render.value) && ignores(render.value as Node);
}

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
