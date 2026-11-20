import { cmd, flag } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Dev extends Model {
  static help = "Run the app - Vite with HMR. Use `dev build` for production.";

  inspect = flag({ default: true, help: "skip the /__inspect relay agents use to read and drive the page" });

  build = cmd({
    lazy: () => import("./build"),
    help: "Build for production - dist/client (static app) and dist/server/index.js (node service).",
  });

  async run() {
    const { runDev } = await import("../vite/dev");

    await runDev(process.cwd(), { inspect: this.inspect });
  }
}
