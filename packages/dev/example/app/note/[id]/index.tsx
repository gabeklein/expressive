import { Link, Route } from "@expressive/dev";
import { Model, get } from "@expressive/mvc";

import { note } from "../../../api/(note)";

export default class Note extends Model {
  route = get(Route);
  text = "";

  protected async new() {
    this.text = await note(this.route.match!.id);
  }
}

export function Page() {
  const { text } = Note.get();

  return (
    <>
      <h1>Note</h1>
      <output>{text}</output>
      <Link to="/note/8">Note 8</Link>
    </>
  );
}
