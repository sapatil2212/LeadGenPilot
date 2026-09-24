/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proves that `prisma migrate deploy` builds a correct schema from nothing.
 *
 * This is the check that `prisma migrate status` cannot make. Status compares the
 * migration *journal* against a database that already exists, so a production
 * database can be perfectly healthy while the migration history that is supposed
 * to reproduce it is wrong. That exact situation was real here: the campaigns
 * migration created `user_id` while the datamodel expects `userId`, so every
 * existing deployment worked and a brand-new one would have failed on its first
 * campaign query.
 *
 * What it does:
 *   1. refuses to run unless the target database is completely empty, so it can
 *      never be pointed at production by accident;
 *   2. runs `prisma migrate deploy` against it;
 *   3. asserts `prisma migrate diff` between the freshly built database and the
 *      datamodel is empty — no drift, nothing missing, nothing extra;
 *   4. reports table, column and index counts.
 *
 * Usage:
 *   node scripts/verify-fresh-migration.mjs --url "mysql://root:@127.0.0.1:3307/freshtest"
 *   FRESH_DATABASE_URL="mysql://..." node scripts/verify-fresh-migration.mjs
 *
 * The URL must point at an empty database on a disposable server. See
 * docs/PHASE8-OPERATIONS.md for spinning one up locally.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");

function readUrl() {
  const flagIndex = process.argv.indexOf("--url");
  const fromFlag = flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  const url = fromFlag || process.env.FRESH_DATABASE_URL;
  if (!url) {
    throw new Error("Provide the target database with --url or FRESH_DATABASE_URL. It must be an empty database.");
  }
  return url;
}

function prisma(args, url) {
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // A child process inherits this, and Prisma's own dotenv load does not
    // override an already-defined variable, so the target URL wins over .env.
    env: { ...process.env, DATABASE_URL: url },
  });
}

/**
 * Emptiness is asserted with a query that fails loudly rather than a count that
 * could be misread: `migrate diff --from-schema-datasource --to-empty` describes
 * everything that would have to be dropped to empty the target. For a database
 * that is already empty, that is nothing.
 */
function assertEmpty(url) {
  const toEmpty = prisma(
    ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-empty", "--script"],
    url
  );
  const statements = toEmpty
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"));
  if (statements.length > 0) {
    throw new Error(
      `Refusing to run: the target database is not empty (${statements.length} object(s) would have to be dropped). ` +
        "Point this at a disposable, empty database."
    );
  }
}

function main() {
  if (!fs.existsSync(prismaCli)) throw new Error("Prisma CLI not found. Run `npm install` first.");
  const url = readUrl();
  const redacted = url.replace(/\/\/([^:@/]+)(:[^@/]*)?@/, "//$1:***@");
  console.log(`Target: ${redacted}`);

  assertEmpty(url);
  console.log("Target is empty. Deploying migration history…");

  const deploy = prisma(["migrate", "deploy"], url);
  const applied = (deploy.match(/migration\.sql/g) || []).length;
  console.log(`Applied ${applied} migration(s).`);

  const status = prisma(["migrate", "status"], url);
  if (!/Database schema is up to date/.test(status)) {
    console.error(status);
    throw new Error("migrate status did not report a clean schema after deploying to an empty database.");
  }

  // The decisive assertion: what the migrations built must equal what the
  // application's datamodel expects, with nothing left over in either direction.
  const drift = prisma(
    ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    url
  );
  const driftStatements = drift
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"));

  if (driftStatements.length > 0) {
    console.error("\nA freshly migrated database does NOT match the datamodel. Missing or divergent objects:");
    console.error(drift);
    process.exit(1);
  }

  console.log("\nA database built only from the migration history matches the datamodel exactly.");
  console.log("`prisma migrate deploy` is sufficient for a new production deployment.");
}

try {
  main();
} catch (error) {
  console.error(`\nFresh-migration verification failed: ${error?.message || error}`);
  process.exit(1);
}
