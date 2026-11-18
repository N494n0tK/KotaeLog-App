import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  workers: 2,
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory ..",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
    colorScheme: "dark",
    serviceWorkers: "block",
  },
  projects: ["chromium", "webkit"].map(browserName => ({ name: browserName, use: { browserName } })),
});
