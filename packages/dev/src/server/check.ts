import type { Settings } from "../settings";

const GUIDE = "https://github.com/gabeklein/expressive/tree/main/packages/dev#from-05";
const KEYS = new Set(["target", "port", "remote", "handle", "host"]);

/** Throw if `settings` holds a key 0.6 does not read, naming where it went; `exports` are the file's named ones. `env` is read only from `index.dev.ts`. */
export function check(settings: unknown, exports: Iterable<string> = [], file: "index.ts" | "index.dev.ts" = "index.ts"): Settings {
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message} See ${GUIDE}`);
  };

  if (typeof settings != "object" || settings === null) return fail("the default export is not config({ ... }).");

  for (const name of exports) if (name === "bindings") fail("`bindings` became `config.env`, set in index.dev.ts.");

  for (const [key, value] of Object.entries(settings)) {
    if (KEYS.has(key) || (key === "env" && file === "index.dev.ts")) continue;
    if (key === "fetch" || key === "around") fail("`fetch` and `around` became `handle`.");
    if (key === "env") fail("`env` is set in index.dev.ts, never index.ts.");
    if (typeof value == "function") fail(`\`${key}\` goes in \`host\`.`);

    fail(`\`${key}\` is not a setting.`);
  }

  const { target, host } = settings as Settings;

  if (host && target !== "fetch") fail("`host` is for the fetch target only - Node has no module host to hand an export to.");

  return settings as Settings;
}
