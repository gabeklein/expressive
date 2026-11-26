import { Redirect } from "@expressive/dev";
import { Component } from "@expressive/mvc";

export default class Admin extends Component {
  protected new() {
    if (!globalThis.localStorage?.getItem("admin")) throw new Redirect("/");
  }

  render() {
    return <h1>Admin area</h1>;
  }
}
