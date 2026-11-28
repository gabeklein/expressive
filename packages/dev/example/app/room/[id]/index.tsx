import { Link, Route } from "@expressive/dev";
import { Model, get } from "@expressive/mvc";

import { enter } from "../../../api/(room)";

export default class Room extends Model {
  route = get(Route);
  id = "";

  protected async new() {
    this.id = await enter(this.route.match!.id);
  }
}

export function Page() {
  const { id } = Room.get();

  return (
    <>
      <h1>Room {id}</h1>
      <Link to={`/room/${id}/notes`}>Notes</Link> {" | "}
      <Link to="/room/2">Room 2</Link>
    </>
  );
}
