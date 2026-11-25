import { Current } from "@expressive/dev/server";

export async function served() {
  return Current.get().url.pathname;
}
