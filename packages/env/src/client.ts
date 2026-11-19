import { load } from "./files";

export function exposed(root: string, mode: string, prefix: string | false): Record<string, string> {
  const files = load(root, mode);
  const keys = prefix
    ? [...Object.keys(files), ...Object.keys(process.env)].filter(key => key.startsWith(prefix))
    : Object.keys(files);

  return Object.fromEntries(keys.map(key => [key, process.env[key] ?? files[key]]));
}

export function client(values: Record<string, string>, prefix: string | false): string {
  const json = JSON.stringify(values);

  if (!prefix) return `export const env = Object.freeze(${json});\n`;

  const tag = JSON.stringify(prefix);

  return `\
const values = ${json};

export const env = new Proxy(values, {
  get(target, key) {
    if (typeof key !== "string" || key in target || !/^[A-Z][A-Z0-9_]*$/.test(key)) return target[key];
    throw new Error(key.startsWith(${tag})
      ? \`env.\${key} was not set when the client was built.\`
      : \`env.\${key} is server-only - name it \${${tag}}\${key} to expose it to the client.\`);
  },
  set: () => false,
});
`;
}
