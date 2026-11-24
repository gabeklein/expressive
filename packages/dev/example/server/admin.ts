import { Model } from "@expressive/mvc";
import { Current } from "@expressive/dev/server";
import { Forbidden } from "@expressive/rpc";

export class Admin extends Model {
  name = "";

  protected async new() {
    const { admin } = Current.get().cookies;

    if (admin !== "root") throw new Forbidden("Admins only.");

    this.name = admin;
  }
}
