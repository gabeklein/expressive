import { flag } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Build extends Model {
  pretty = flag({ help: "skip minifying the client and keep filenames stable - for reading or diffing output" });

  html = flag({ default: true, help: "skip prerendering static pages - every page renders in the browser" });

  env = flag({ default: true, help: "skip copying .env files into process.env, here and at the built server's boot - env still reads them" });

  async run() {
    const { runBuild } = await import("../vite/build");

    await runBuild(process.cwd(), { pretty: this.pretty, html: this.html, env: this.env });
  }
}
