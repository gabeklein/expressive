import { Forbidden, Redirect } from "@expressive/dev/server";

export async function enter(id: string) {
  if (id == "locked") throw new Forbidden("This room is locked.");
  if (id == "old") throw new Redirect("/room/new");

  return id;
}
