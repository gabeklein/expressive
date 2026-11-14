import { command, flag } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export class Build extends Model {
  pretty = flag({ help: "unminified client, stable filenames" });

  async run() {
    const { runBuild } = await import("../vite/build");

    await runBuild(process.cwd(), { pretty: this.pretty });
  }
}

export default command(Build);
