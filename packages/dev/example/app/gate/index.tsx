import { Component, set } from "@expressive/mvc";

import { welcome } from "./remote";

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
