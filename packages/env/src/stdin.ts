import { text } from "node:stream/consumers";

export async function piped(): Promise<string | undefined> {
  if (process.stdin.isTTY) return;

  return (await text(process.stdin)).replace(/\r?\n$/, "");
}
