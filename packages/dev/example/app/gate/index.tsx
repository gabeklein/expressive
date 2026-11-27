import { Model } from "@expressive/mvc";

import { welcome } from "../../api/gate";

export default class Visit extends Model {
  name = "";

  protected async new() {
    this.name = await welcome();
  }
}

export function Page() {
  const { name } = Visit.get();

  return (
    <>
      <h1>Gate</h1>
      <p>Welcome, {name}</p>
    </>
  );
}
