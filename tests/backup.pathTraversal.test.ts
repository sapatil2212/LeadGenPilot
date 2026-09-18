/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGRESSION TESTS — BackupService path handling
 *
 * `backupId` arrives from the URL (/api/production/backups/:id/...) and was
 * interpolated straight into a filesystem path, so "../../server" escaped the
 * backup directory. restoreBackup also handed the archive to
 * unzipper.Extract({ path: process.cwd() }), which writes whatever paths the
 * archive declares — a zip-slip write primitive over the application directory.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/prisma", () => ({
  prisma: {},
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

/*
 * The logger writes to scraper-log.txt and checks the file for rotation, so it
 * would show up in the fs spy below and make "did the code under test touch the
 * filesystem?" ambiguous. Stub it out.
 */
vi.mock("../src/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    clear: vi.fn(),
    readLogs: vi.fn().mockReturnValue(""),
  },
}));

// Keep the real path/traversal logic but observe filesystem access.
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}));
vi.mock("fs", () => ({ default: fsMock, ...fsMock }));

const { BackupService } = await import("../src/backup");

let service: InstanceType<typeof BackupService>;

beforeEach(() => {
  fsMock.existsSync.mockReturnValue(false);
  // The constructor calls ensureBackupDir(), which touches the filesystem.
  // Build first, then clear, so the assertions below only see calls made by
  // the method under test.
  service = new BackupService();
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(false);
});

const TRAVERSAL_IDS = [
  "../../etc/passwd",
  "..\\..\\windows\\system32\\config",
  "../server",
  "/etc/shadow",
  "backup/../../secret",
  "a/b",
  "..",
  ".",
];

describe("restoreBackup rejects traversal in the backup id", () => {
  it.each(TRAVERSAL_IDS)("refuses %j without touching the filesystem", async (id) => {
    await expect(service.restoreBackup(id)).resolves.toBe(false);
    expect(fsMock.existsSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("deleteBackup rejects traversal in the backup id", () => {
  it.each(TRAVERSAL_IDS)("refuses %j without unlinking anything", (id) => {
    expect(service.deleteBackup(id)).toBe(false);
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("well-formed ids are still processed", () => {
  it("looks up a plausible id and reports missing when absent", async () => {
    fsMock.existsSync.mockReturnValue(false);
    await expect(service.restoreBackup("backup_2026-09-18T08-09-25-940Z")).resolves.toBe(false);
    // It got as far as checking for the file, unlike the rejected ids above.
    expect(fsMock.existsSync).toHaveBeenCalled();
  });

  it("accepts the id shape createBackup generates", async () => {
    const generated = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fsMock.existsSync.mockReturnValue(false);
    await service.restoreBackup(generated);
    expect(fsMock.existsSync).toHaveBeenCalled();
  });

  it("rejects an over-long id", async () => {
    await expect(service.restoreBackup("a".repeat(129))).resolves.toBe(false);
    expect(fsMock.existsSync).not.toHaveBeenCalled();
  });

  it("rejects an empty id", async () => {
    await expect(service.restoreBackup("")).resolves.toBe(false);
    expect(fsMock.existsSync).not.toHaveBeenCalled();
  });
});
