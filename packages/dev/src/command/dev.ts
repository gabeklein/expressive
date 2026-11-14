import { command } from "@expressive/cli";
import { Model } from "@expressive/mvc";

export class Dev extends Model {
  async run() {
    const { runDev } = await import("../vite/dev");

    await runDev();
  }
}

export default command(Dev);
