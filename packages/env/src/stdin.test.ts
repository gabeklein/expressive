import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";

import { piped } from "./stdin";

const original = Object.getOwnPropertyDescriptor(process, "stdin")!;

afterEach(() => {
  Object.defineProperty(process, "stdin", original);
});

const stdin = (stream: object) => Object.defineProperty(process, "stdin", { value: stream, configurable: true });

it("will read piped input without its trailing newline", async () => {
  stdin(Readable.from(["s3cret\n"]));

  expect(await piped()).toBe("s3cret");
});

it("will read nothing from a terminal", async () => {
  stdin({ isTTY: true });

  expect(await piped()).toBeUndefined();
});
