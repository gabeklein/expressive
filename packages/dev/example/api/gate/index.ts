import { Model } from "@expressive/mvc";
import { Current, Redirect } from "@expressive/dev/server";

export class Banned extends Error {
  status = 403;
}

class Gate extends Model {
  name = "";

  protected async new() {
    const { gate } = Current.get().cookies;

    if (!gate || gate == "guest") throw new Redirect("/login");
    if (gate == "banned") throw new Banned("Banned from the gate.");

    await new Promise(resolve => setTimeout(resolve, 100));

    this.name = gate;
  }
}

export default () => void Gate.new();

export async function welcome() {
  return Gate.get().name;
}
