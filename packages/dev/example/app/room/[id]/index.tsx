import { Link, Route } from "@expressive/dev";

export class Page extends Route {
  render() {
    const id = this.match?.id;

    return (
      <>
        <h1>Room {id}</h1>
        <Link to={`/room/${id}/notes`}>Notes</Link> {" | "}
        <Link to="/room/2">Room 2</Link>
      </>
    );
  }
}
