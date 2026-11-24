import { Component, set } from "@expressive/mvc";

import { member, welcome } from "./remote";

export default async () => ((await member()) ? undefined : "/login");

export class Page extends Component {
  name = set(() => welcome());

  render() {
    return (
      <>
        <h1>Gate</h1>
        <p>Welcome, {this.name}</p>
      </>
    );
  }
}
