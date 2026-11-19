import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { args, cmd, flag, opt } from "@expressive/cli";
import { Model } from "@expressive/mvc";

import { DECLARATION, undeclared, write } from "./declaration";
import { EXAMPLE, at, load, mode, parse, read, scan, where } from "./files";
import { piped } from "./stdin";

const KEY = /^[A-Za-z_][\w.-]*$/;
const PAIR = /^([A-Za-z_][\w.-]*)(?:=([\s\S]*))?$/;

const inMode = () => opt({ short: "m", default: mode(), help: "mode whose files load - default NODE_ENV, else development" });
const keysArg = () => args({ min: 1, valid: (key: string) => KEY.test(key), help: "key names" });
const inFile = () =>
  opt({
    short: "f",
    default: ".env",
    parse: (file: string) => (/^[^./][^/]*$/.test(file) ? `.env.${file}` : file),
    help: "file to edit - `example`, `local`, `production.local` mean .env.<name>",
  });

function resolved(root: string, mode: string) {
  const files = load(root, mode);

  return (key: string): string | undefined => process.env[key] ?? files[key];
}

function quote(value: string): string {
  if (/^[^\s#'"`]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;

  throw new Error("The value holds ', ` and whitespace or # - edit the file by hand.");
}

function edit(text: string, key: string, replace?: string): string | undefined {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const found = scan(text).filter(entry => entry.name === key);

  if (!found.length) return;

  if (replace === undefined)
    for (const entry of found.reverse()) lines.splice(entry.start, entry.end - entry.start);
  else {
    const last = found[found.length - 1];
    lines.splice(last.line, last.end - last.line, /^\s*(?:export\s+)?/.exec(lines[last.line])![0] + replace);
  }

  return lines.join(eol);
}


class Sync extends Model {
  run() {
    const result = write(process.cwd());

    if (!result) {
      console.error(`No .env files in ${process.cwd()}.`);
      return false;
    }

    console.log(result === "current" ? `${DECLARATION} is current.` : `Wrote ${DECLARATION}.`);
  }
}

function problemsIn(root: string, mode: string): string[] {
  const value = resolved(root, mode);
  const found = Object.keys(parse(join(root, EXAMPLE)))
    .filter(key => !value(key))
    .map(key => `${key} is ${value(key) === undefined ? "unset" : "empty"} - ${EXAMPLE} lists it.`);

  const missing = undeclared(root);

  if (missing.length) found.push(`${DECLARATION} does not declare ${missing.join(", ")} - run \`expressive env\`.`);

  return found;
}

class Check extends Model {
  mode = inMode();

  run() {
    const root = process.cwd();
    const problems = problemsIn(root, this.mode);

    for (const problem of problems) console.error(problem);
    if (!problems.length) console.log(`${DECLARATION} declares every key; ${read(join(root, EXAMPLE)) === undefined ? `no ${EXAMPLE} to check values against` : `every key in ${EXAMPLE} is set`}.`);

    return !problems.length;
  }
}

class List extends Model {
  mode = inMode();

  run() {
    const root = process.cwd();
    const value = resolved(root, this.mode);
    const keys = [...new Set([...Object.keys(parse(join(root, EXAMPLE))), ...Object.keys(load(root, this.mode))])];
    const rows = keys.map(key => {
      const found = value(key);
      const state = found === undefined ? "<unset>" : found ? `${found.length} chars` : "<empty>";

      return [key, state, where(root, this.mode, key) ?? at(join(root, EXAMPLE), EXAMPLE, key)];
    });

    const width = (column: number) => Math.max(0, ...rows.map(row => row[column].length));

    for (const [key, state, from] of rows) console.log(`${key.padEnd(width(0))}  ${state.padEnd(width(1))}  ${from}`);
  }
}

class Read extends Model {
  keys = keysArg();
  length = flag({ short: "l", help: "print each value's length instead of the value" });
  mode = inMode();

  run() {
    const value = resolved(process.cwd(), this.mode);
    const missing = this.keys.filter(key => value(key) === undefined);

    if (missing.length) {
      console.error(`Not set: ${missing.join(", ")}.`);
      return false;
    }

    const values = this.keys.map(key => (this.length ? String(value(key)!.length) : value(key)!));

    process.stdout.write(values.length === 1 && !this.length ? values[0] : values.join("\n") + "\n");
  }
}

class Write extends Model {
  pairs = args({ min: 1, valid: (pair: string) => PAIR.test(pair), help: "KEY=value to set; one bare KEY reads its value from stdin" });
  file = inFile();

  async run() {
    const entries = this.pairs.map(pair => PAIR.exec(pair)!.slice(1, 3) as [string, string | undefined]);
    const bare = entries.filter(([, value]) => value === undefined);

    if (bare.length > 1) {
      console.error(`Only one key can read stdin - give ${bare.slice(1).map(([key]) => key).join(", ")} as KEY=value.`);
      return 2;
    }

    if (bare.length) {
      const value = await piped();

      if (!value) {
        console.error(value === undefined ? `Give ${bare[0][0]} a value - ${bare[0][0]}=value - or pipe one in.` : `stdin was empty - ${bare[0][0]}= empties a key.`);
        return 2;
      }

      bare[0][1] = value;
    }

    const root = process.cwd();
    const path = join(root, this.file);
    const lines = entries.map(([key, value]) => [key, `${key}=${quote(value!)}`, value!.length] as const);
    let text = read(path) ?? "";

    for (const [key, line] of lines)
      text = edit(text, key, line) ?? text + (text && !text.endsWith("\n") ? "\n" : "") + line + "\n";

    writeFileSync(path, text);
    write(root);

    for (const [key, , length] of lines) console.log(`Set ${key} in ${this.file} (${length} chars).`);
  }
}

class Unset extends Model {
  keys = keysArg();
  file = inFile();

  run() {
    const root = process.cwd();
    const path = join(root, this.file);
    let text = read(path) ?? "";
    let ok = true;

    for (const key of this.keys) {
      const edited = edit(text, key);

      if (edited === undefined) {
        console.error(`${key} is not in ${this.file}.`);
        ok = false;
        continue;
      }

      text = edited;
      writeFileSync(path, text);

      const still = where(root, mode(), key);
      console.log(`Removed ${key} from ${this.file}${still ? ` - still set by ${still}` : ""}.`);
    }

    write(root);
    return ok;
  }
}

export default class Env extends Model {
  mode = inMode();

  run() {
    const root = process.cwd();
    const result = write(root);

    if (!result) {
      console.log(`No .env files in ${root} - nothing to prepare.`);
      return;
    }

    console.log(result === "current" ? `${DECLARATION} is current.` : `Wrote ${DECLARATION}.`);

    for (const problem of problemsIn(root, this.mode)) console.warn(problem);
  }

  sync = cmd({ from: Sync, help: `write ${DECLARATION} - key names and comments from the .env files` });
  check = cmd({ from: Check, help: `fail if a key in ${EXAMPLE} is unset or ${DECLARATION} is stale` });
  list = cmd({ from: List, help: "list keys with length or <empty>/<unset> and the file:line each comes from - never values" });
  read = cmd({ from: Read, help: "print values raw, one per line, for piping into another command" });
  write = cmd({ from: Write, help: "set KEY=value pairs in a .env file; a bare KEY reads stdin" });
  unset = cmd({ from: Unset, help: "remove keys and their doc comments from a .env file" });
}
