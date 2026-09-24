/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";
import { logger } from "./logger";
import archiver from "archiver";
import { duplicateChecker } from "./duplicateChecker";
import { loadFailedLeads } from "./googleSheetsWebhook";
import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

/**
 * Automated backup system for lead data and configurations.
 * Production-grade data protection with versioning.
 */

/**
 * The data files createBackup() puts into an archive AND is willing to write
 * back on restore.
 *
 * Deliberately excluded from restore:
 *   .env.masked    — a redacted copy; restoring it would be meaningless.
 *   metadata.json  — the archive's own manifest, whose name collides with the
 *                    application's metadata.json at the repository root.
 *                    Restoring it would have silently clobbered a source file.
 */
const BACKUP_ENTRIES = [
  "processed-leads.json",
  "failed-leads.json",
  "leadfinder-config.json",
] as const;

export interface BackupMetadata {
  id: string;
  timestamp: string;
  leadsCount: number;
  failedLeadsCount: number;
  size: number;
  path: string;
  /** Per-table row counts captured from MySQL, absent when the database was unreachable. */
  database?: {
    included: boolean;
    totalRows: number;
    tables: Record<string, { rows: number; truncated: boolean }>;
    error?: string;
  };
}

/**
 * Rows dumped per table before the dump is marked truncated. A backup that
 * exhausts the API process's memory protects nothing, so the limit is explicit
 * and recorded in the manifest rather than silently unbounded.
 */
const MAX_ROWS_PER_TABLE = 100_000;
const DB_DUMP_PAGE_SIZE = 5_000;

/**
 * Backup ids are generated as `backup_<ISO timestamp with : and . replaced>`,
 * so they only ever contain word characters and hyphens. Ids arrive from the
 * URL and are interpolated into a filesystem path, so anything outside this
 * shape is rejected rather than sanitized — `../../server` must not resolve.
 */
const BACKUP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isValidBackupId(id: string): boolean {
  return BACKUP_ID_RE.test(String(id ?? ""));
}

/**
 * Environment keys whose values are operational settings rather than secrets and
 * are therefore kept readable in the archived copy of `.env`.
 *
 * This list is an allow-list on purpose. The previous approach named the secrets
 * to hide, which fails silently the moment a new secret is introduced: a mask
 * list containing "API_KEY" does not cover `ENCRYPTION_KEY`, so the key used to
 * encrypt tenant integration credentials was written into every backup archive in
 * clear text. Anything not named here is masked, so a new variable is private by
 * default and the worst case of a mistake is a less informative backup.
 */
const NON_SECRET_ENV_KEYS = new Set([
  "NODE_ENV",
  "PORT",
  "HOST",
  "APP_URL",
  "LOG_LEVEL",
  "LOG_MAX_BYTES",
  "AUTH_ENABLED",
  "BODY_LIMIT",
  "CORS_ORIGIN",
  "CORS_ORIGINS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "SMTP_FROM_NAME",
  "EMAIL_POLL_INTERVAL_MS",
  "CAMPAIGN_WORKER_POLL_MS",
  "CAMPAIGN_WORKER_DRAIN_MS",
  "CAMPAIGN_LEASE_RENEW_MS",
  "WORKER_ID",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX",
  "BACKUP_INTERVAL_HOURS",
]);

/**
 * Returns `.env` content with every value masked except the operational settings
 * above. Key names and comments are preserved, because knowing which variables a
 * deployment defined is the useful part of archiving the file at all.
 */
export function maskEnvContent(content: string): string {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/.exec(line);
      if (!match) return line; // comment, blank line, or continuation
      const [, indent, key, separator, value] = match;
      if (!value.trim()) return line;
      if (NON_SECRET_ENV_KEYS.has(key.toUpperCase())) return line;
      return `${indent}${key}${separator}********`;
    })
    .join("\n");
}

export class BackupService {
  private backupDir: string;
  private maxBackups: number;

  constructor(backupDir = "backups", maxBackups = 30) {
    this.backupDir = path.join(process.cwd(), backupDir);
    this.maxBackups = maxBackups;
    this.ensureBackupDir();
  }

  /**
   * Resolves a backup id to a path inside the backup directory, or null if the
   * id is malformed or escapes the directory. Belt and braces: the pattern
   * check alone is sufficient, but the containment check means a future change
   * to the pattern cannot reintroduce traversal.
   */
  private resolveBackupPath(backupId: string, extension: ".zip" | ".json"): string | null {
    if (!isValidBackupId(backupId)) {
      logger.warn(`Rejected backup id with unexpected characters: ${JSON.stringify(String(backupId).slice(0, 80))}`);
      return null;
    }
    const resolved = path.resolve(this.backupDir, `${backupId}${extension}`);
    const root = path.resolve(this.backupDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      logger.warn("Rejected backup id that resolved outside the backup directory.");
      return null;
    }
    return resolved;
  }

  private ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      logger.info(`Created backup directory: ${this.backupDir}`);
    }
  }

  /**
   * Create a full backup of all lead data and configurations.
   */
  async createBackup(): Promise<BackupMetadata> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupId = `backup_${timestamp}`;
    const backupPath = path.join(this.backupDir, `${backupId}.zip`);

    logger.info(`Creating backup: ${backupId}`);

    const leads = duplicateChecker.loadLeads();
    const failedLeads = loadFailedLeads();
    // The database is the product's source of truth for workspaces, campaigns,
    // delivery reports, conversations and suppressions. A backup of three JSON
    // files protected none of it.
    const dump = await this.dumpDatabase();

    const output = fs.createWriteStream(backupPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on("close", () => {
        const size = archive.pointer();
        const metadata: BackupMetadata = {
          id: backupId,
          timestamp,
          leadsCount: leads.length,
          failedLeadsCount: failedLeads.length,
          size,
          path: backupPath,
          database: {
            included: dump.included,
            totalRows: dump.totalRows,
            tables: dump.tables,
            ...(dump.error ? { error: dump.error } : {}),
          },
        };

        // Save metadata
        const metadataPath = path.join(this.backupDir, `${backupId}.json`);
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        logger.success(`Backup created: ${backupId} (${this.formatSize(size)})`);
        this.cleanOldBackups();
        resolve(metadata);
      });

      archive.on("error", (err) => {
        logger.error(`Backup failed: ${err.message}`);
        reject(err);
      });

      archive.pipe(output);

      // One JSON document per table, under database/, so a restore can be done
      // table by table and a human can read what was captured.
      for (const [table, json] of dump.documents) {
        archive.append(json, { name: `database/${table}.json` });
      }

      // Add data files
      const processedLeadsPath = path.join(process.cwd(), "processed-leads.json");
      const failedLeadsPath = path.join(process.cwd(), "failed-leads.json");
      const configPath = path.join(process.cwd(), "leadfinder-config.json");
      const envPath = path.join(process.cwd(), ".env");

      if (fs.existsSync(processedLeadsPath)) {
        archive.file(processedLeadsPath, { name: "processed-leads.json" });
      }
      if (fs.existsSync(failedLeadsPath)) {
        archive.file(failedLeadsPath, { name: "failed-leads.json" });
      }
      if (fs.existsSync(configPath)) {
        archive.file(configPath, { name: "leadfinder-config.json" });
      }
      if (fs.existsSync(envPath)) {
        // Backup .env but with sensitive data masked
        const envContent = fs.readFileSync(envPath, "utf8");
        const maskedEnv = this.maskSensitiveData(envContent);
        archive.append(maskedEnv, { name: ".env.masked" });
      }

      // Add backup metadata
      archive.append(
        JSON.stringify(
          {
            backupId,
            timestamp,
            leadsCount: leads.length,
            failedLeadsCount: failedLeads.length,
            nodeVersion: process.version,
            platform: process.platform,
            database: {
              included: dump.included,
              totalRows: dump.totalRows,
              tables: dump.tables,
              ...(dump.error ? { error: dump.error } : {}),
            },
          },
          null,
          2
        ),
        { name: "metadata.json" }
      );

      archive.finalize();
    });
  }

  /**
   * Reads every mapped table into JSON documents for the archive.
   *
   * The table list comes from the generated datamodel, not from a hand-written
   * array, so a model added later is included automatically instead of being
   * quietly omitted from every backup taken afterwards.
   *
   * A database outage does not fail the backup: the file-based stores are still
   * worth capturing, and the manifest records that the database was missed so the
   * gap is visible rather than assumed.
   */
  private async dumpDatabase(): Promise<{
    included: boolean;
    totalRows: number;
    tables: Record<string, { rows: number; truncated: boolean }>;
    documents: Array<[string, string]>;
    error?: string;
  }> {
    const tables: Record<string, { rows: number; truncated: boolean }> = {};
    const documents: Array<[string, string]> = [];
    let totalRows = 0;

    const models = (Prisma as any)?.dmmf?.datamodel?.models as Array<{ name: string; dbName?: string }> | undefined;
    if (!Array.isArray(models) || models.length === 0) {
      return { included: false, totalRows: 0, tables, documents, error: "Prisma datamodel unavailable; run prisma generate." };
    }

    try {
      for (const model of models) {
        const table = model.dbName || model.name;
        const delegate = (prisma as any)[model.name.charAt(0).toLowerCase() + model.name.slice(1)];
        if (!delegate?.findMany) continue;

        const rows: unknown[] = [];
        let truncated = false;
        // Paged reads keep one enormous table from being materialised in a
        // single query, and stop at an explicit ceiling.
        for (let skip = 0; skip < MAX_ROWS_PER_TABLE; skip += DB_DUMP_PAGE_SIZE) {
          const page = await delegate.findMany({ skip, take: DB_DUMP_PAGE_SIZE });
          rows.push(...page);
          if (page.length < DB_DUMP_PAGE_SIZE) break;
          if (rows.length >= MAX_ROWS_PER_TABLE) {
            truncated = true;
            break;
          }
        }

        tables[table] = { rows: rows.length, truncated };
        totalRows += rows.length;
        documents.push([table, JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)]);
      }
      return { included: true, totalRows, tables, documents };
    } catch (error: any) {
      const message = error?.message || String(error);
      logger.warn(`Backup could not read the database; the archive will cover files only: ${message}`);
      return { included: false, totalRows, tables, documents, error: message };
    }
  }

  /**
   * List all available backups.
   */
  listBackups(): BackupMetadata[] {
    const files = fs.readdirSync(this.backupDir);
    const metadataFiles = files.filter((f) => f.endsWith(".json"));

    return metadataFiles
      .map((file) => {
        try {
          const content = fs.readFileSync(path.join(this.backupDir, file), "utf8");
          return JSON.parse(content) as BackupMetadata;
        } catch (error) {
          return null;
        }
      })
      .filter((m): m is BackupMetadata => m !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Restore from a backup.
   */
  async restoreBackup(backupId: string): Promise<boolean> {
    const backupPath = this.resolveBackupPath(backupId, ".zip");
    if (!backupPath) return false;

    if (!fs.existsSync(backupPath)) {
      logger.error(`Backup not found: ${backupId}`);
      return false;
    }

    logger.info(`Restoring backup: ${backupId}`);

    try {
      const unzipper = await import("unzipper");
      const target = path.resolve(process.cwd());

      /*
       * Entry-by-entry extraction with an explicit containment check.
       *
       * unzipper.Extract() writes whatever paths the archive declares, so an
       * archive containing "../../.ssh/authorized_keys" or an absolute path
       * escapes the target directory ("zip slip"). Only the known backup
       * payload filenames are restored; anything else is skipped and logged.
       */
      const allowed = new Set<string>(BACKUP_ENTRIES);
      const directory = await unzipper.Open.file(backupPath);
      let restored = 0;
      let databaseDumps = 0;

      for (const entry of directory.files) {
        if (entry.type !== "File") continue;

        const entryName = entry.path.replace(/\\/g, "/");
        const base = path.posix.basename(entryName);

        /*
         * Table dumps are carried by the archive but never written back from
         * here. Overwriting live workspaces, campaigns and delivery history from
         * an HTTP request is not a recovery procedure — it is an outage. They are
         * restored deliberately, by an operator, against a chosen database.
         */
        if (entryName.startsWith("database/") && entryName.endsWith(".json")) {
          databaseDumps++;
          continue;
        }

        if (entryName !== base || !allowed.has(base)) {
          logger.warn(`Skipped unexpected archive entry during restore: ${JSON.stringify(entryName.slice(0, 120))}`);
          continue;
        }

        const destination = path.resolve(target, base);
        if (!destination.startsWith(target + path.sep)) {
          logger.warn("Skipped archive entry that resolved outside the working directory.");
          continue;
        }

        fs.writeFileSync(destination, await entry.buffer());
        restored++;
      }

      if (databaseDumps > 0) {
        logger.info(
          `Archive also contains ${databaseDumps} database table dump(s). Database restore is a deliberate operator action and was not performed by this request.`
        );
      }
      logger.success(`Backup restored: ${backupId} (${restored} file(s))`);
      return restored > 0;
    } catch (error: any) {
      logger.error(`Restore failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete a backup.
   */
  deleteBackup(backupId: string): boolean {
    const backupPath = this.resolveBackupPath(backupId, ".zip");
    const metadataPath = this.resolveBackupPath(backupId, ".json");
    if (!backupPath || !metadataPath) return false;

    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }
      logger.info(`Backup deleted: ${backupId}`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to delete backup: ${error.message}`);
      return false;
    }
  }

  /**
   * Clean old backups, keeping only maxBackups most recent.
   */
  private cleanOldBackups() {
    const backups = this.listBackups();
    if (backups.length <= this.maxBackups) return;

    const toDelete = backups.slice(this.maxBackups);
    toDelete.forEach((backup) => {
      this.deleteBackup(backup.id);
    });

    logger.info(`Cleaned ${toDelete.length} old backup(s)`);
  }

  /**
   * Mask sensitive data in .env content.
   */
  private maskSensitiveData(content: string): string {
    return maskEnvContent(content);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

export const backupService = new BackupService();

/**
 * Schedule automatic daily backups.
 */
export function scheduleAutomaticBackups(intervalHours = 24) {
  const intervalMs = intervalHours * 60 * 60 * 1000;

  setInterval(async () => {
    try {
      logger.info("Running scheduled backup...");
      await backupService.createBackup();
    } catch (error: any) {
      logger.error(`Scheduled backup failed: ${error.message}`);
    }
  }, intervalMs);

  logger.info(`Scheduled automatic backups every ${intervalHours} hours`);
}
