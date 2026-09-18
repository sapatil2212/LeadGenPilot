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

export interface BackupMetadata {
  id: string;
  timestamp: string;
  leadsCount: number;
  failedLeadsCount: number;
  size: number;
  path: string;
}

export class BackupService {
  private backupDir: string;
  private maxBackups: number;

  constructor(backupDir = "backups", maxBackups = 30) {
    this.backupDir = path.join(process.cwd(), backupDir);
    this.maxBackups = maxBackups;
    this.ensureBackupDir();
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
    const backupPath = path.join(this.backupDir, `${backupId}.zip`);
    
    if (!fs.existsSync(backupPath)) {
      logger.error(`Backup not found: ${backupId}`);
      return false;
    }

    logger.info(`Restoring backup: ${backupId}`);

    try {
      // Extract backup (requires unzipper)
      const unzipper = await import("unzipper");
      const extract = await fs
        .createReadStream(backupPath)
        .pipe(unzipper.Extract({ path: process.cwd() }))
        .promise();

      logger.success(`Backup restored: ${backupId}`);
      return true;
    } catch (error: any) {
      logger.error(`Restore failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete a backup.
   */
  deleteBackup(backupId: string): boolean {
    const backupPath = path.join(this.backupDir, `${backupId}.zip`);
    const metadataPath = path.join(this.backupDir, `${backupId}.json`);

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
