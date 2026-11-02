import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // A production build on its own database file, deleted first so every run starts from a fresh seed.
  webServer: {
    command: `rm -f .data/e2e.db .data/e2e.db-wal .data/e2e.db-shm && npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: { DB_PATH: ".data/e2e.db" },
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
