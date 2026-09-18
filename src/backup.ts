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
}

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

      for (const entry of directory.files) {
        if (entry.type !== "File") continue;

        const entryName = entry.path.replace(/\\/g, "/");
        const base = path.posix.basename(entryName);

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
    const sensitiveKeys = [
      "DATABASE_URL",
      "JWT_SECRET",
      "API_KEY",
      "SMTP_PASS",
      "GEMINI_API_KEY",
      "PASSWORD",
      "SECRET",
      "TOKEN",
    ];

    let masked = content;
    sensitiveKeys.forEach((key) => {
      const regex = new RegExp(`(${key}=)(.+)`, "gi");
      masked = masked.replace(regex, "$1********");
    });

    return masked;
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
