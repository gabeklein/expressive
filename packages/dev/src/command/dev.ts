import { cmd } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Dev extends Model {
  build = cmd({
    lazy: () => import("./build"),
    help: "Build for production - dist/client (static app) and dist/server/index.js (node service).",
  });

  async run() {
    const { runDev } = await import("../vite/dev");

    await runDev();
  }
}
