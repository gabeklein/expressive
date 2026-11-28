import { Component } from "@expressive/mvc";
import { Forbidden } from "@expressive/dev";

import { Locked, lock, whoami } from "../api/admin/(desk)";

export class Page extends Component {
  shown = "";

  async run(task: () => Promise<unknown>) {
    try {
      this.shown = String(await task());
    } catch (error) {
      if (error instanceof Locked) this.shown = `Locked until ${error.until}`;
      else if (error instanceof Forbidden) this.shown = `Forbidden: ${error.message}`;
      else this.shown = (error as Error).message;
    }
  }

  render() {
    const { shown, run } = this;

    return (
      <>
        <h1>Staff</h1>
        <button onClick={() => run(whoami)}>Who</button>
        <button onClick={() => run(lock)}>Lock</button>
        <output>{shown}</output>
      </>
    );
  }
}
