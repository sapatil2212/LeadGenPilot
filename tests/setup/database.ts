/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-database redirection.
 *
 * Integration tests must never touch the production database. `src/prisma` reads
 * `DATABASE_URL` at import time, so the redirection has to happen in a setup file
 * that runs before any application module is loaded — hence this file rather than
 * a helper called from inside a test.
 *
 * Set `TEST_DATABASE_URL` to a disposable database and every test in the run will
 * use it. With nothing set, the integration suite refuses to run rather than
 * silently writing to whatever `.env` happens to point at.
 */
const testUrl = process.env.TEST_DATABASE_URL?.trim();

if (testUrl) {
  process.env.DATABASE_URL = testUrl;
  process.env.PRISMA_HIDE_UPDATE_MESSAGE = "1";
}

/** True when a test file may talk to a real database. */
export const hasTestDatabase = Boolean(testUrl);
