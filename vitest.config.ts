/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vitest configuration.
 *
 * Deliberately separate from vite.config.ts: the app's Vite config loads the
 * React and Tailwind plugins, which are irrelevant for the Node-side unit
 * tests and only slow them down. Component tests, if added later, should get
 * their own project entry with environment: "jsdom".
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    // tests/integration/** needs a real MySQL and its own timeouts; it runs from
    // vitest.integration.config.ts via `npm run test:integration`. Excluding it
    // here keeps `npm run test:run` runnable with no infrastructure at all, so a
    // red default suite always means a real defect.
    exclude: [
      "node_modules/**",
      "dist/**",
      "leadfinder-landing/**",
      "backups/**",
      "tests/integration/**",
      "tests/e2e/**",
    ],
    setupFiles: ["tests/setup/database.ts"],
    // These tests must never reach the network, the filesystem stores or the
    // database, so a slow test is a broken test.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.tsx",
        "src/analysis/types.ts",
        "src/types.ts",
      ],
    },
  },
});
