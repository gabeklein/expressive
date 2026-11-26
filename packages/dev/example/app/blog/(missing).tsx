import { NotFound } from "@expressive/dev";

export function Page() {
  throw new NotFound("Post missing does not exist.");
}
