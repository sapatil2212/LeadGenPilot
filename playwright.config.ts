/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser end-to-end configuration.
 *
 * The suite drives the real dashboard against the real Express server and a real
 * MySQL schema. That is the point: every layer below the browser already has
 * coverage, and the failures those layers cannot see are the ones that live in the
 * wiring — a lazily loaded panel that never resolves, a fetch that omits its
 * credentials, a route the UI calls with a shape the API does not accept.
 *
 * Required environment:
 *   E2E_DATABASE_URL  a disposable MySQL database, already migrated
 *
 * The server is built and started by Playwright itself, so a run is one command:
 *   npm run test:e2e
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3123);
const baseURL = `http://127.0.0.1:${PORT}`;
const databaseUrl = process.env.E2E_DATABASE_URL || "";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  // The suite shares one seeded database, so specs run in sequence rather than
  // racing each other through the same workspace.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    // Artefacts only for failures, so a green run leaves nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    // Serve the production bundle: testing the built artefact is what makes this
    // a deployment check and not just a dev-server check.
    command: "node dist/server.cjs",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      // Deterministic secrets for the test process only. The API key guard stays
      // off so the browser can call the API the way a real session does.
      JWT_SECRET: "e2e-jwt-secret-value-not-used-in-production",
      ENCRYPTION_KEY: "e2e-encryption-key-not-used-in-prod",
      API_KEY: "",
      CORS_ORIGINS: baseURL,
      LOG_LEVEL: "warn",
      /*
       * Every spec signs in and the dashboard polls status, campaign progress and
       * the inbox on timers, so a 24-test run from one address exceeds the
       * production limit of 300 requests/minute and starts getting 429s that have
       * nothing to do with the behaviour under test. The limiter itself is covered
       * by tests/security.middleware.test.ts; here it is raised out of the way.
       */
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "100000",
      // Nothing in the suite should reach a provider or a scheduler.
      EMAIL_POLL_INTERVAL_MS: "3600000",
      BACKUP_INTERVAL_HOURS: "24",
      DISABLE_WHATSAPP: "true",
    },
  },
});
