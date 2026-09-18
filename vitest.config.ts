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
    exclude: ["node_modules/**", "dist/**", "leadfinder-landing/**", "backups/**"],
    // Tests must never reach the network, the filesystem stores or the
    // database. Anything needing those belongs in an integration suite with
    // explicit setup, added in a later phase.
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
