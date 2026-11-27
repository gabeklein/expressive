import { init, parse } from "es-module-lexer";
import { parseAst, transformWithOxc } from "vite";
import { isClass, moduleOf, type Value } from "@expressive/rpc/vite";

import type { ExportScanner } from "./routes";

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
  if (isFunction(value)) return ignores(value as Node);
  if (!isClass(value)) return false;

  const render = (value.body.body as Node[]).find(member =>
    (member.type === "MethodDefinition" || member.type === "PropertyDefinition") && !member.computed && member.key.type === "Identifier" && member.key.name === "render");

  return !!render && isFunction(render.value) && ignores(render.value as Node);
}

function kindOf(value: Value): boolean | undefined {
  if (value?.type === "ClassDeclaration" || value?.type === "ClassExpression") return true;
  if (isFunction(value)) return false;
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

const isFunction = (value: Value): boolean =>
  value?.type === "FunctionDeclaration" || value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression";
