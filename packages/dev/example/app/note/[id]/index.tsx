import { Component, Model } from "@expressive/mvc";
import { Link } from "@expressive/dev";

import { served } from "./remote";

export default class Note extends Model {
  protected async new() { await served(); }
}

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
        <Link to="/note/8">Note 8</Link>
      </>
    );
  }
}
