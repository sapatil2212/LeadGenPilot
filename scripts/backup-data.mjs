/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only backup tool.
 *
 * Dumps every MySQL table to JSON and copies the file-based operational
 * stores (which are the production source of truth for campaigns,
 * conversations and dedupe) into a timestamped backup directory, then writes
 * a MANIFEST.json with SHA-256 checksums and row/byte counts.
 *
 * SAFETY: this script only ever READS. It issues no INSERT/UPDATE/DELETE and
 * no DDL. It never copies .env files, so a backup directory can be handled
 * with less caution than the repository root.
 *
 * Usage:
 *   node scripts/backup-data.mjs                 # new backups/backup-<stamp>/
 *   node scripts/backup-data.mjs <outputDir>     # explicit target directory
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * The model list is derived from the generated datamodel rather than written out
 * by hand.
 *
 * It was a hand-written list of seven tables, frozen at the pre-tenancy schema.
 * Everything added afterwards — workspaces, memberships, jobs, campaigns,
 * campaign messages, delivery reports, conversations, suppressions, the business
 * knowledge base, ICP and scoring — was silently absent from every backup, so a
 * restore would have returned the product to its first week while reporting
 * success. Deriving the list means a model added tomorrow is backed up tonight.
 */
function discoverModels() {
  const models = Prisma.dmmf?.datamodel?.models;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("Could not read the Prisma datamodel. Run `npx prisma generate` first.");
  }
  return models
    .map((model) => ({
      model: model.name.charAt(0).toLowerCase() + model.name.slice(1),
      table: model.dbName || model.name,
    }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * File-based stores. Secret-bearing files (.env*, .wwebjs_auth) are
 * deliberately absent — see the SAFETY note above.
 */
const RUNTIME_FILES = [
  "processed-leads.json",
  "failed-leads.json",
  "campaign-history.json",
  "conversations.json",
  "email-poll-state.json",
  "leadfinder-config.json",
  "scan-history.json",
  "scraper-log.txt",
];

/** BigInt/Date-safe JSON serializer — Prisma returns both. */
function serialize(value) {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

async function main() {
  const outRoot = process.argv[2] || path.join("backups", `backup-${timestamp()}`);
  const dataDir = path.join(outRoot, "data");
  const filesDir = path.join(outRoot, "runtime-files");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(filesDir, { recursive: true });

  const manifest = {
    createdAt: new Date().toISOString(),
    purpose: "Operational safety backup: every mapped table plus the file-based stores",
    readOnly: true,
    database: { reachable: false, tables: {}, totalRows: 0, error: null },
    runtimeFiles: {},
    excluded: [
      ".env / .env.example / utils/.env (credentials — intentionally not backed up here)",
      ".wwebjs_auth/ (live WhatsApp session credentials)",
    ],
  };

  // ── 1. Database tables ──
  const models = discoverModels();
  manifest.database.modelCount = models.length;

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    manifest.database.reachable = true;

    for (const { model, table } of models) {
      const delegate = prisma[model];
      if (!delegate?.findMany) {
        manifest.database.tables[table] = { error: `no Prisma delegate "${model}"` };
        continue;
      }
      const rows = await delegate.findMany();
      const target = path.join(dataDir, `${table}.json`);
      fs.writeFileSync(target, serialize(rows), "utf8");
      manifest.database.tables[table] = {
        model,
        rows: rows.length,
        bytes: fs.statSync(target).size,
        sha256: sha256(target),
      };
      manifest.database.totalRows += rows.length;
      console.log(`  [db]   ${table.padEnd(24)} ${String(rows.length).padStart(6)} rows`);
    }

    // A table that exists in the database but in no model would be lost on
    // restore, so it is reported rather than ignored.
    const present = await prisma.$queryRawUnsafe(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
    );
    const covered = new Set(models.map((entry) => entry.table));
    const uncovered = present
      .map((row) => row.name)
      .filter((name) => name !== "_prisma_migrations" && !covered.has(name));
    manifest.database.uncoveredTables = uncovered;
    if (uncovered.length) {
      console.warn(`  [db]   WARNING: ${uncovered.length} table(s) are not covered by any model: ${uncovered.join(", ")}`);
    }
  } catch (err) {
    manifest.database.error = err?.message || String(err);
    console.error(`  [db]   FAILED: ${manifest.database.error}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  // ── 2. File-based operational stores ──
  for (const name of RUNTIME_FILES) {
    if (!fs.existsSync(name)) {
      manifest.runtimeFiles[name] = { present: false };
      console.log(`  [file] ${name.padEnd(24)} absent`);
      continue;
    }
    const target = path.join(filesDir, name);
    fs.copyFileSync(name, target);
    const bytes = fs.statSync(target).size;
    manifest.runtimeFiles[name] = { present: true, bytes, sha256: sha256(target) };
    console.log(`  [file] ${name.padEnd(24)} ${String(bytes).padStart(8)} bytes`);
  }

  fs.writeFileSync(path.join(outRoot, "MANIFEST.json"), serialize(manifest), "utf8");
  console.log(`\nBackup written to ${outRoot}`);
  console.log(`Database rows captured: ${manifest.database.totalRows}`);

  // A backup that silently captured nothing is worse than a loud failure.
  if (!manifest.database.reachable) {
    console.error("\nWARNING: the database was NOT reachable. This backup covers files only.");
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
