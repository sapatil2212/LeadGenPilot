/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Restores a Phase 0 style backup (scripts/backup-data.mjs output) into the
 * database currently configured in DATABASE_URL.
 *
 * Ids are preserved so foreign keys line up, and tables are written in
 * dependency order. Writes use createMany({ skipDuplicates: true }), so a
 * partially-completed run can be repeated safely.
 *
 * SAFETY
 *   - Requires --confirm. Without it the script only reports what it would do.
 *   - Refuses to write to a table that already has rows unless --merge is given,
 *     so an accidental second run cannot interleave with live data.
 *   - Skips page_views unless --include-page-views. That table is bulk
 *     analytics PII (raw IP, user agent, referrer) with no retention policy and
 *     no tenant scoping; restoring 24k rows of it into a fresh database is
 *     rarely what you want.
 *
 * Usage
 *   node scripts/import-backup-data.mjs                       # dry run, latest backup
 *   node scripts/import-backup-data.mjs --confirm             # import
 *   node scripts/import-backup-data.mjs <dir> --confirm       # explicit backup dir
 *   node scripts/import-backup-data.mjs --confirm --merge
 *   node scripts/import-backup-data.mjs --confirm --include-page-views
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Insert order matters: every table is written after the table it references.
 * `dateFields` lists the DateTime columns, because JSON round-tripping turns
 * them into strings and Prisma requires Date objects.
 */
const TABLES = [
  {
    file: "users.json",
    model: "user",
    dateFields: ["lockedUntil", "lastLoginAt", "createdAt", "updatedAt"],
  },
  {
    file: "user_integrations.json",
    model: "userIntegration",
    dateFields: ["lastUsedAt", "createdAt", "updatedAt"],
  },
  {
    file: "email_otps.json",
    model: "emailOtp",
    dateFields: ["expiresAt", "createdAt"],
  },
  {
    file: "audit_logs.json",
    model: "auditLog",
    dateFields: ["createdAt"],
  },
  {
    file: "lead_lists.json",
    model: "leadList",
    dateFields: ["scrapedAt", "createdAt", "updatedAt"],
  },
  {
    file: "leads.json",
    model: "lead",
    // NOTE: `dateAdded` is a String column, not a DateTime. Do not convert it.
    dateFields: ["createdAt", "updatedAt"],
  },
  {
    file: "page_views.json",
    model: "pageView",
    dateFields: ["createdAt"],
    optional: true,
  },
];

const CHUNK_SIZE = 500;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const confirm = flags.has("--confirm");
const merge = flags.has("--merge");
const includePageViews = flags.has("--include-page-views");

function resolveBackupDir() {
  if (positional[0]) return positional[0];
  const pointer = path.join("backups", ".LATEST");
  if (fs.existsSync(pointer)) return fs.readFileSync(pointer, "utf8").trim();
  throw new Error(
    "No backup directory given and backups/.LATEST is missing. " +
      "Pass the directory explicitly: node scripts/import-backup-data.mjs <dir> --confirm"
  );
}

function reviveDates(row, dateFields) {
  const out = { ...row };
  for (const field of dateFields) {
    if (out[field] !== undefined && out[field] !== null) out[field] = new Date(out[field]);
  }
  return out;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const prisma = new PrismaClient();

try {
  const backupDir = resolveBackupDir();
  const dataDir = path.join(backupDir, "data");
  if (!fs.existsSync(dataDir)) {
    throw new Error(`No data directory in the backup: ${dataDir}`);
  }

  console.log(`Backup   : ${backupDir}`);
  console.log(`Database : ${(process.env.DATABASE_URL || "").replace(/\/\/[^@]*@/, "//<redacted>@")}`);
  console.log(`Mode     : ${confirm ? (merge ? "IMPORT (merge)" : "IMPORT") : "DRY RUN (pass --confirm to write)"}`);
  console.log("");

  const plan = [];
  let blocked = false;

  for (const table of TABLES) {
    if (table.model === "pageView" && !includePageViews) {
      console.log(`  ${table.model.padEnd(16)} skipped (pass --include-page-views to restore analytics PII)`);
      continue;
    }

    const filePath = path.join(dataDir, table.file);
    if (!fs.existsSync(filePath)) {
      if (!table.optional) console.log(`  ${table.model.padEnd(16)} no ${table.file} in backup — skipped`);
      continue;
    }

    const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`  ${table.model.padEnd(16)} backup holds 0 rows — nothing to do`);
      continue;
    }

    const existing = await prisma[table.model].count();
    if (existing > 0 && !merge) {
      console.log(
        `  ${table.model.padEnd(16)} BLOCKED: target already has ${existing} row(s). ` +
          "Re-run with --merge to add anyway."
      );
      blocked = true;
      continue;
    }

    console.log(
      `  ${table.model.padEnd(16)} ${String(rows.length).padStart(6)} row(s) from backup` +
        (existing > 0 ? `  (target already has ${existing})` : "")
    );
    plan.push({ table, rows });
  }

  if (blocked) {
    console.log("\nNothing was written. Resolve the blocked tables above first.");
    process.exitCode = 1;
  } else if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to write these rows.");
  } else {
    console.log("\nImporting...");
    let total = 0;

    for (const { table, rows } of plan) {
      const prepared = rows.map((r) => reviveDates(r, table.dateFields));
      let written = 0;

      for (const batch of chunk(prepared, CHUNK_SIZE)) {
        try {
          const result = await prisma[table.model].createMany({
            data: batch,
            skipDuplicates: true,
          });
          written += result.count;
        } catch (err) {
          // A field mismatch means the backup predates a schema change.
          throw new Error(
            `Failed writing ${table.model}: ${err?.message || err}\n` +
              "If the schema changed since this backup was taken, the row shape no longer matches."
          );
        }
      }

      total += written;
      const skipped = prepared.length - written;
      console.log(
        `  ${table.model.padEnd(16)} wrote ${String(written).padStart(6)}` +
          (skipped > 0 ? `  (${skipped} already present, skipped)` : "")
      );
    }

    console.log(`\nDone. ${total} row(s) written.`);
    console.log("Run 'node scripts/verify-tenant-ownership.mjs' to confirm ownership reconciles.");
  }
} catch (err) {
  console.error(`\nImport failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
