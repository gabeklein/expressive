import { cmd, flag, opt } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export default class Dev extends Model {
  static help = "Run the app - Vite with HMR. Use `dev build` for production.";

  port = opt({ short: "p", type: "number", valid: n => Number.isInteger(n) && n >= 0 && n <= 65535, help: "port to listen on - over index.ts's port and Vite's" });

  inspect = flag({ default: true, help: "skip the /__inspect relay agents use to read and drive the page" });

  env = flag({ default: true, help: "skip copying .env files into process.env - env still reads them" });

  build = cmd({
    lazy: () => import("./build"),
    help: "Build for production - dist/client (static app) and dist/server/index.js (node service).",
  });

  async run() {
    const { runDev } = await import("../vite/dev");

    await runDev(process.cwd(), { inspect: this.inspect, port: this.port, env: this.env });
  }
}
