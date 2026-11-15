import { cmd, flag } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Dev extends Model {
  inspect = flag({ default: true, help: "serve the /__inspect relay agents use to read and drive the page" });

  build = cmd({
    lazy: () => import("./build"),
    help: "Build for production - dist/client (static app) and dist/server/index.js (node service).",
  });

  async run() {
    const { runDev } = await import("../vite/dev");

    await runDev(process.cwd(), { inspect: this.inspect });
  }
}
