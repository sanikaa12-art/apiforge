import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real app (React + API + Postgres).
 * Prerequisites: database running and seeded (`npm run db:start`, `npm run db:seed -w server`).
 * Playwright starts the API and web dev servers itself, or reuses ones already running.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: "npm run dev -w server", cwd: "..", url: "http://localhost:4000/api/health", reuseExistingServer: true, timeout: 60_000 },
    { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true, timeout: 60_000 },
  ],
});
