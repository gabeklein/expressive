import { flag } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Build extends Model {
  pretty = flag({ help: "skip minifying the client and keep filenames stable - for reading or diffing output" });

  html = flag({ default: true, help: "skip prerendering static pages - every page renders in the browser" });

  async run() {
    const { runBuild } = await import("../vite/build");

    await runBuild(process.cwd(), { pretty: this.pretty, html: this.html });
  }
}
