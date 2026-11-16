import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export const EXAMPLE = ".env.example";

const ENV_FILE = /^\.env(\.[\w.-]+)?$/;
const ASSIGN = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/;
const COMMENT = /^\s*#\s?(.*)$/;

export interface Key {
  name: string;
  doc?: string;
  section?: string;
  /** Zero-based line of the assignment. */
  line: number;
  /** First line of its doc comment, else `line`. */
  start: number;
  /** Line after its value - past a multi-line value's close. */
  end: number;
}

export function mode(): string {
  return process.env.NODE_ENV || "development";
}

export function files(mode: string): string[] {
  return [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
}

export function read(path: string): string | undefined {
  if (statSync(path, { throwIfNoEntry: false })?.isFile()) return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

export function envFiles(root: string): string[] {
  const found = readdirSync(root).filter(name => ENV_FILE.test(name)).sort();
  const first = [EXAMPLE, ".env"].filter(name => found.includes(name));

  return [...first, ...found.filter(name => !first.includes(name))];
}

export function parse(path: string): Record<string, string> {
  const text = read(path);

  return text === undefined ? {} : (parseEnv(text) as Record<string, string>);
}

export function load(root: string, mode: string): Record<string, string> {
  return Object.assign({}, ...files(mode).map(file => parse(join(root, file))));
}

export function where(root: string, mode: string, key: string): string | undefined {
  if (key in process.env) return "process.env";

  const file = files(mode).reverse().find(file => key in parse(join(root, file)));

  return file && `${file}:${line(join(root, file), key)}`;
}

export function line(path: string, key: string): number {
  return scan(readFileSync(path, "utf8")).findLast(found => found.name === key)!.line + 1;
}

export function scan(text: string): Key[] {
  const lines = text.split(/\r?\n/);
  const keys: Key[] = [];
  let block: string[] = [];
  let section: string | undefined;
  let quote: string | undefined;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (quote) {
      if (line.includes(quote)) {
        quote = undefined;
        keys[keys.length - 1].end = index + 1;
      }
      continue;
    }

    const comment = COMMENT.exec(line);

    if (comment && !ASSIGN.test(comment[1])) {
      block.push(comment[1].trimEnd());
      continue;
    }

    const assign = ASSIGN.exec(line);

    if (assign) {
      const [, name, value] = assign;
      const open = /^["'`]/.exec(value)?.[0];

      if (open && !value.slice(1).includes(open)) quote = open;

      keys.push({ name, doc: block.join("\n").trim() || undefined, section, line: index, start: index - block.length, end: index + 1 });
    } else if (!comment && block.length) {
      section = block.join(" ").trim() || section;
    }

    block = [];
  }

  return keys;
}
