import { Model } from "@expressive/mvc";
import { Current } from "@expressive/dev/server";

export class Banned extends Error {
  status = 403;
}

export class SignIn extends Error {
  status = 302;
  location = "/login";
}

class Gate extends Model {
  name = "";

  protected async new() {
    const { gate } = Current.get().cookies;

    if (!gate || gate == "guest") throw new SignIn("Sign in to pass the gate.");
    if (gate == "banned") throw new Banned("Banned from the gate.");

    await new Promise(resolve => setTimeout(resolve, 100));

    this.name = gate;
  }
}

export default () => void Gate.new();

export async function welcome() {
  return Gate.get().name;
}
