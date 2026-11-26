// @vitest-environment happy-dom

import { expect, it } from "vitest";

import { mount } from "../../test.setup";
import { NotFound } from "@expressive/rpc";
import { Catch } from "./not-found";

it("will render the default 404 page", async () => {
  const root = await mount(() => <Catch error={new NotFound()} retry={() => {}} />);

  expect(root.querySelector("h1")!.textContent).toBe("404 - Not found");
});

it("will render the default error page", async () => {
  const root = await mount(() => <Catch error={new Error("failure")} retry={() => {}} />);
  expect(root.querySelector("h1")!.textContent).toBe("Something went wrong");
  expect(root.querySelector("button")!.textContent).toBe("Try again");
});
