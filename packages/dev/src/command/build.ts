import { flag } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Build extends Model {
  pretty = flag({ help: "skip minifying the client and keep filenames stable - for reading or diffing output" });

  prerender = flag({ default: true, help: "render static pages to html at build - --no-prerender leaves every page to the browser" });

  async run() {
    const { runBuild } = await import("../vite/build");

    await runBuild(process.cwd(), { pretty: this.pretty, prerender: this.prerender });
  }
}
