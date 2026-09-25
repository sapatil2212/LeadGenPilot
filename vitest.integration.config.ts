/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration test configuration — the suite that talks to a real MySQL.
 *
 * Kept apart from vitest.config.ts for three reasons:
 *
 *  - Timeouts. A unit test that takes 10 seconds is broken; an integration test
 *    that creates a tenant, a list, leads and a campaign over a network round trip
 *    per statement legitimately needs longer. Sharing one timeout meant the
 *    integration suite failed intermittently whenever the database was slow, which
 *    trains everyone to ignore a red suite.
 *  - Isolation. These files share one database and delete rows in setup, so they
 *    must not run in parallel with each other.
 *  - Intent. `npm run test:run` should be runnable with no infrastructure. This
 *    suite declares its dependency explicitly and is run by `npm run test:integration`.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "leadfinder-landing/**", "backups/**"],
    setupFiles: ["tests/setup/database.ts"],
    // Every file shares one schema and truncates its own fixtures, so they are
    // run one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 20_000,
  },
});
