import { Current } from "@expressive/dev/server";

export async function POST() {
  const { json } = Current.get();

  return { echo: await json() };
}
