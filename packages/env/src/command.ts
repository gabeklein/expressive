import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { arg, cmd, flag, opt } from "@expressive/cli";
import { Model } from "@expressive/mvc";

import { DECLARATION, stale, write } from "./declaration";
import { EXAMPLE, load, mode, parse, source } from "./files";
import { piped } from "./stdin";

const KEY = /^[A-Za-z_][\w.-]*$/;

const inMode = () => opt({ short: "m", default: mode(), help: "mode whose files load - default NODE_ENV, else development" });
const keyArg = () => arg({ required: true, valid: (key: string) => KEY.test(key), help: "key name" });

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

class Check extends Model {
  mode = inMode();

  run() {
    const root = process.cwd();
    const value = resolved(root, this.mode);
    const problems = Object.keys(parse(join(root, EXAMPLE)))
      .filter(key => !value(key))
      .map(key => `${key} is ${value(key) === undefined ? "unset" : "empty"} - ${EXAMPLE} lists it.`);

    if (stale(root)) problems.push(`${DECLARATION} is out of date - run \`expressive env sync\`.`);

    for (const problem of problems) console.error(problem);
    if (!problems.length) console.log(`Every key in ${EXAMPLE} is set; ${DECLARATION} is current.`);

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

      return [key, state, source(root, this.mode, key) ?? EXAMPLE];
    });

    const width = (column: number) => Math.max(0, ...rows.map(row => row[column].length));

    for (const [key, state, from] of rows) console.log(`${key.padEnd(width(0))}  ${state.padEnd(width(1))}  ${from}`);
  }
}

class Read extends Model {
  key = keyArg();
  length = flag({ short: "l", help: "print the value's length instead of the value" });
  mode = inMode();

  run() {
    const found = resolved(process.cwd(), this.mode)(this.key);

    if (found === undefined) {
      console.error(`${this.key} is not set.`);
      return false;
    }

    process.stdout.write(this.length ? `${found.length}\n` : found);
  }
}

class Write extends Model {
  key = keyArg();
  value = arg({ help: "value - read from stdin when omitted, so a secret stays out of the shell" });
  file = opt({ short: "f", default: ".env", help: "file to edit" });

  async run() {
    const value = this.value ?? (await piped());

    if (value === undefined) {
      console.error(`Give ${this.key} a value or pipe one in.`);
      return 2;
    }

    const root = process.cwd();
    const path = join(root, this.file);
    const line = `${this.key}=${quote(value)}`;
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    const pattern = new RegExp(`^(\\s*(?:export\\s+)?)${this.key.replace(/\./g, "\\.")}\\s*=.*$`, "m");

    if (pattern.test(text)) writeFileSync(path, text.replace(pattern, (_, lead: string) => lead + line));
    else appendFileSync(path, (text && !text.endsWith("\n") ? "\n" : "") + line + "\n");

    write(root);
    console.log(`Set ${this.key} in ${this.file} (${value.length} chars).`);
  }
}

export default class Env extends Model {
  sync = cmd({ from: Sync, help: `write ${DECLARATION} - key names and comments from the .env files` });
  check = cmd({ from: Check, help: `fail if a key in ${EXAMPLE} is unset or ${DECLARATION} is stale` });
  list = cmd({ from: List, help: "list keys with length or <empty>/<unset> and the file each comes from - never values" });
  read = cmd({ from: Read, help: "print one value raw, for piping into another command" });
  write = cmd({ from: Write, help: "set a key in a .env file; reads the value from stdin when omitted" });
}
