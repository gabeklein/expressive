import { Forbidden } from "@expressive/dev/server";
import { Current } from "@expressive/dev/server";

export default () => {
  const { id } = Current.get().params;

  if (id == "locked") throw new Forbidden("This room is locked.");
  if (id == "old") return new Response(null, { status: 307, headers: { location: "/room/1" } });
};
