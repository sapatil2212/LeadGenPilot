/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prepares the end-to-end environment before the browser starts: assert a
 * disposable database was named, apply migrations to it, seed it, and make sure a
 * production bundle exists to serve.
 *
 * Doing this here rather than in a README step means a run is reproducible by one
 * command, which is the difference between an E2E suite that is maintained and one
 * that rots.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command: string, args: string[], env: Record<string, string | undefined> = {}) {
  execFileSync(command, args, { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, ...env } });
}

export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "E2E_DATABASE_URL is not set. The browser suite writes and deletes rows, so it must be pointed at a disposable database. See docs/PHASE8-OPERATIONS.md."
    );
  }
  if (/77\.37\.|prod/i.test(databaseUrl)) {
    throw new Error("E2E_DATABASE_URL looks like a production database. Refusing to run.");
  }

  const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  console.log("[e2e] applying migrations to the test database…");
  run(process.execPath, [prismaCli, "migrate", "deploy"], { DATABASE_URL: databaseUrl });

  console.log("[e2e] seeding fixtures…");
  run(process.execPath, ["tests/e2e/seed.mjs"], { E2E_DATABASE_URL: databaseUrl });

  // Playwright starts the web server before this hook, so a missing bundle
  // already surfaced as a module-resolution error. Checking anyway makes the
  // cause legible in the log next to it: `vite build` empties dist/, so running
  // it alone removes the server bundle that esbuild put there. `npm run build`
  // does both in the right order, which is why `pretest:e2e` runs it.
  const bundle = path.join(process.cwd(), "dist", "server.cjs");
  const client = path.join(process.cwd(), "dist", "index.html");
  if (!fs.existsSync(bundle) || !fs.existsSync(client)) {
    throw new Error("dist/server.cjs or dist/index.html is missing. Run `npm run build` before the browser suite.");
  }
}
