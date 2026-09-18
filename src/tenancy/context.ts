/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tenant context: who is asking, on behalf of which workspace, and what are
 * they allowed to do.
 *
 * Establishing this once per request is what lets the data layer refuse to
 * build an unscoped query. Route handlers receive a TenantContext and pass it
 * to a repository; they never assemble a `where` clause with a tenant id in it
 * by hand, which is how the pre-Phase-1 `req.authUser?.id ?? null` scope came
 * to leak every tenant's data.
 */

import type { Request, Response, NextFunction } from "express";
import { env } from "../env";
import { logger } from "../logger";
import { listMemberships, findMembership, type Membership } from "./tenantService";
import { resolvePermissions, type Permission, type TenantRole } from "./permissions";

export interface TenantContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: TenantRole | string;
  tenantName: string;
  tenantSlug: string;
  permissions: Set<Permission>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only after resolveTenantContext has run successfully. */
      ctx?: TenantContext;
    }
  }
}

/** Header a multi-workspace client sends to choose which workspace to act on. */
export const TENANT_HEADER = "x-tenant-id";

function toContext(userId: string, membership: Membership): TenantContext {
  return {
    userId,
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    role: membership.role,
    tenantName: membership.tenantName,
    tenantSlug: membership.tenantSlug,
    permissions: resolvePermissions(membership.role, membership.permissions),
  };
}

/**
 * Resolves the acting workspace for this request.
 *
 * Order of resolution:
 *   1. An explicit X-Tenant-Id header (or ?tenantId=) — must correspond to an
 *      active membership of the signed-in user, otherwise 403. Note this is a
 *      preference, never a grant: the membership lookup is the authority, so
 *      sending someone else's tenant id achieves nothing.
 *   2. Exactly one active membership — the common case, used implicitly. This
 *      is why the existing frontend needs no changes.
 *   3. Several memberships and no choice made — 400, asking the client to pick.
 *      Guessing here would mean writing a lead into whichever workspace
 *      happened to sort first.
 *   4. No memberships — 403. The auth flow provisions a workspace on sign-in,
 *      so this means the account predates tenancy and needs the backfill.
 */
export async function resolveTenantContext(req: Request, res: Response, next: NextFunction) {
  try {
    if (!env.isDatabaseConfigured()) {
      return res.status(503).json({
        error: "This feature requires a configured database.",
        code: "db_unconfigured",
      });
    }

    const userId = req.authUser?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required.", code: "no_session" });
    }

    const requested =
      (req.get(TENANT_HEADER) || "").trim() ||
      (typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : "");

    if (requested) {
      const membership = await findMembership(userId, requested);
      if (!membership) {
        logger.warn(`Rejected a request for workspace ${requested}: no active membership.`);
        return res.status(403).json({
          error: "You do not have access to that workspace.",
          code: "tenant_forbidden",
        });
      }
      if (membership.tenantStatus !== "active") {
        return res.status(403).json({
          error: "That workspace is suspended.",
          code: "tenant_suspended",
        });
      }
      req.ctx = toContext(userId, membership);
      return next();
    }

    const memberships = await listMemberships(userId);
    const usable = memberships.filter((m) => m.tenantStatus === "active");

    if (usable.length === 1) {
      req.ctx = toContext(userId, usable[0]);
      return next();
    }

    if (usable.length > 1) {
      return res.status(400).json({
        error: "You belong to several workspaces. Specify which one to use.",
        code: "tenant_required",
        tenants: usable.map((m) => ({ id: m.tenantId, name: m.tenantName, slug: m.tenantSlug, role: m.role })),
      });
    }

    if (memberships.length > 0) {
      return res.status(403).json({ error: "Your workspace is suspended.", code: "tenant_suspended" });
    }

    return res.status(403).json({
      error: "No workspace is associated with this account.",
      code: "no_tenant",
    });
  } catch (err) {
    logger.error("Failed to resolve tenant context", err);
    return res.status(500).json({ error: "Could not resolve your workspace.", code: "internal" });
  }
}

/**
 * Requires a specific capability within the resolved workspace. Must be mounted
 * after resolveTenantContext; a missing context is treated as a programming
 * error and refused rather than waved through.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) {
      logger.error(
        `requirePermission(${permission}) ran without a tenant context on ${req.method} ${req.originalUrl}. ` +
          "resolveTenantContext must be mounted first."
      );
      return res.status(500).json({ error: "Authorization is misconfigured.", code: "internal" });
    }

    if (!ctx.permissions.has(permission)) {
      return res.status(403).json({
        error: `Your role in this workspace does not allow this action.`,
        code: "permission_denied",
        permission,
        role: ctx.role,
      });
    }

    next();
  };
}

/**
 * Reads the context or throws. For use inside handlers already behind
 * resolveTenantContext, so the non-null assertion lives in one place.
 */
export function ctxOf(req: Request): TenantContext {
  if (!req.ctx) {
    throw new Error("Tenant context missing: resolveTenantContext did not run for this route.");
  }
  return req.ctx;
}
