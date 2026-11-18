import { defineConfig } from "@playwright/test";

const dev = 3101;
const prod = 3102;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    browserName: "chromium",
    trace: process.env.CI ? "retain-on-failure" : "off",
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
  },
  projects: [
    { name: "dev", testIgnore: /\/(hot|stats)\.spec/, use: { baseURL: `http://localhost:${dev}/` } },
    { name: "prod", testIgnore: /\/(hot|stats|drift)\.spec/, use: { baseURL: `http://localhost:${prod}/` } },
    { name: "dev-edits", testMatch: /\/hot\.spec/, dependencies: ["dev"], use: { baseURL: `http://localhost:${dev}/` } },
    { name: "dev-stats", testMatch: /\/stats\.spec/, dependencies: ["dev-edits"], use: { baseURL: `http://localhost:${dev}/` } },
  ],
  webServer: [
    { command: `rm -rf node_modules/.vite ../node_modules/.vite && mkdir -p .e2e && PORT=${dev} node ../dist/cli.js dev 2>&1 | tee .e2e/dev.log`, port: dev, reuseExistingServer: false },
    { command: `node ../dist/cli.js dev build && PORT=${prod} node dist/server/index.js`, port: prod, reuseExistingServer: false },
  ],
});
