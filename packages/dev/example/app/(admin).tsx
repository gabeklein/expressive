import { Redirect } from "@expressive/dev";

export function Page() {
  if (!globalThis.localStorage?.getItem("admin")) throw new Redirect("/");
  return <h1>Admin area</h1>;
}
