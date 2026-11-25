import { Component } from "@expressive/mvc";

import { served } from "./remote";

export default async () => {
  await served();
};

export class Page extends Component {
  shown = "";

  async where() {
    this.shown = await served();
  }

  render() {
    const { shown, where } = this;

    return (
      <>
        <h1>Note</h1>
        <button onClick={where}>Where</button>
        <output>{shown}</output>
      </>
    );
  }
}
