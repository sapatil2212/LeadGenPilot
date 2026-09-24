/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGRESSION TESTS — /api/production authorization
 *
 * This router imported requireAuth and never applied it. Mounted before the
 * auth middleware, it left 13 endpoints anonymous — including backup create,
 * list, delete, and a restore endpoint that extracts an archive over the
 * application working directory — while the 7 endpoints that checked
 * req.authUser could never pass because nothing populated it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  ADMIN_USER,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

// The backup service touches the filesystem and archiver on import; stub it.
vi.mock("../src/backup", () => ({
  backupService: {
    createBackup: vi.fn().mockResolvedValue({ id: "backup_x" }),
    listBackups: vi.fn().mockReturnValue([]),
    restoreBackup: vi.fn().mockResolvedValue(true),
    deleteBackup: vi.fn().mockReturnValue(true),
  },
  scheduleAutomaticBackups: vi.fn(),
}));

const { issueSessionToken } = await import("../src/authService");
const { attachEntitlements } = await import("../src/entitlements");
const productionRoutes = (await import("../src/productionRoutes")).default;
const { backupService } = await import("../src/backup");
const { env } = await import("../src/env");

const originalRestoreFlag = env.enableBackupRestore;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", attachEntitlements);
  app.use("/api/production", productionRoutes);
  return app;
}

function cookieFor(user: { id: string; email: string; role: string }) {
  return `${env.auth.cookieName}=${issueSessionToken(user)}`;
}

let app: express.Express;

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === TENANT_A.id) return TENANT_A;
    if (where.id === ADMIN_USER.id) return ADMIN_USER;
    return null;
  });
  env.enableBackupRestore = false;
  app = buildApp();
  vi.clearAllMocks();
});

afterEach(() => {
  env.enableBackupRestore = originalRestoreFlag;
});

describe("every endpoint requires a session", () => {
  const routes: [string, string][] = [
    ["get", "/api/production/analytics/dashboard"],
    ["get", "/api/production/analytics/user"],
    ["get", "/api/production/analytics/performance"],
    ["post", "/api/production/analytics/performance/reset"],
    ["get", "/api/production/export/leads/csv"],
    ["get", "/api/production/export/failed-leads/csv"],
    ["get", "/api/production/export/analytics/csv"],
    ["get", "/api/production/notifications"],
    ["get", "/api/production/notifications/count"],
    ["post", "/api/production/backups/create"],
    ["get", "/api/production/backups"],
    ["post", "/api/production/backups/backup_x/restore"],
    ["delete", "/api/production/backups/backup_x"],
    ["get", "/api/production/system/health"],
  ];

  it.each(routes)("%s %s rejects an anonymous caller", async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(401);
  });
});

describe("cross-tenant data requires admin", () => {
  const adminOnly: [string, string][] = [
    ["get", "/api/production/analytics/dashboard"],
    ["get", "/api/production/analytics/performance"],
    ["post", "/api/production/analytics/performance/reset"],
    ["get", "/api/production/export/leads/csv"],
    ["get", "/api/production/export/failed-leads/csv"],
    ["get", "/api/production/export/analytics/csv"],
    ["post", "/api/production/backups/create"],
    ["get", "/api/production/backups"],
    ["delete", "/api/production/backups/backup_x"],
    ["get", "/api/production/system/health"],
  ];

  it.each(adminOnly)("%s %s refuses a signed-in non-admin", async (method, path) => {
    const res = await (request(app) as any)[method](path).set("Cookie", cookieFor(TENANT_A)).send({});
    expect(res.status).toBe(403);
  });

  it("allows an admin to list backups", async () => {
    const res = await request(app).get("/api/production/backups").set("Cookie", cookieFor(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(backupService.listBackups).toHaveBeenCalled();
  });

  /**
   * The global lead CSV was previously downloadable by anyone with the URL.
   */
  it("does not read the global lead store for a non-admin", async () => {
    const res = await request(app)
      .get("/api/production/export/leads/csv")
      .set("Cookie", cookieFor(TENANT_A));
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).not.toContain("text/csv");
  });
});

describe("per-user endpoints work for a normal session", () => {
  it("reaches the notifications handler rather than 401ing forever", async () => {
    const res = await request(app)
      .get("/api/production/notifications")
      .set("Cookie", cookieFor(TENANT_A));

    // These routes were dead before the mount-order fix: req.authUser was never
    // populated, so they always returned 401.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("backup restore", () => {
  it("is refused even for an admin while ENABLE_BACKUP_RESTORE is off", async () => {
    const res = await request(app)
      .post("/api/production/backups/backup_x/restore")
      .set("Cookie", cookieFor(ADMIN_USER));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("restore_disabled");
    expect(backupService.restoreBackup).not.toHaveBeenCalled();
  });

  it("still refuses a non-admin when the flag is on", async () => {
    env.enableBackupRestore = true;
    const res = await request(app)
      .post("/api/production/backups/backup_x/restore")
      .set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(403);
    expect(backupService.restoreBackup).not.toHaveBeenCalled();
  });

  it("proceeds only for an admin with the flag on", async () => {
    env.enableBackupRestore = true;
    const res = await request(app)
      .post("/api/production/backups/backup_x/restore")
      .set("Cookie", cookieFor(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(backupService.restoreBackup).toHaveBeenCalledWith("backup_x");
  });
});
