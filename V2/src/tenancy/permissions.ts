/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Roles and permissions for tenant membership.
 *
 * Roles are defined in code rather than in database tables, and a member's
 * effective permissions are derived from their role at request time. That keeps
 * authorization off the query path entirely: the membership row is already being
 * loaded to establish the tenant, so no join and no extra round trip is needed
 * to answer "may this person do that".
 *
 * `TenantMember.permissions` holds an optional JSON array that REPLACES the
 * role defaults for one member, which covers the "everything except sending" or
 * "read-only auditor" cases without inventing custom roles. Tenant-defined
 * custom roles are a later addition; when they arrive they become rows that
 * resolve to the same Permission set, so nothing downstream changes.
 */

/**
 * Every distinct capability in the product. Deliberately finer-grained than the
 * roles, because the interesting authorization questions are about single
 * irreversible actions, not job titles.
 */
export const PERMISSIONS = [
  "VIEW_LEADS",
  "EDIT_LEADS",
  "DELETE_LEADS",
  "EXPORT_LEADS",
  "RUN_LEAD_DISCOVERY",
  "MANAGE_CRM",
  "CREATE_CAMPAIGN",
  "SEND_CAMPAIGN",
  "MANAGE_TEMPLATES",
  "VIEW_ANALYTICS",
  "MANAGE_INTEGRATIONS",
  "MANAGE_BUSINESS_PROFILE",
  "MANAGE_TEAM",
  "MANAGE_BILLING",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

export const TENANT_ROLES = ["owner", "admin", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export function isTenantRole(value: unknown): value is TenantRole {
  return value === "owner" || value === "admin" || value === "member";
}

/**
 * Default permissions per role.
 *
 * The two deliberate restrictions on `member`:
 *
 *   SEND_CAMPAIGN — a member can compose and prepare a campaign but not put
 *   messages in front of real people. Outbound send is the one action in this
 *   product that cannot be undone, and the brief's own workflow requires an
 *   explicit human approval before launch. Separating CREATE from SEND is what
 *   makes that approval gate mean something.
 *
 *   RUN_LEAD_DISCOVERY — a discovery run consumes the tenant's metered lead
 *   quota and takes the shared browser capacity, so it spends money and
 *   throughput on the tenant's behalf.
 *
 * MANAGE_BILLING is owner-only: an admin can run the workspace day to day
 * without being able to change the plan or the payment method.
 */
export const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  owner: PERMISSIONS,

  admin: PERMISSIONS.filter((p) => p !== "MANAGE_BILLING"),

  member: [
    "VIEW_LEADS",
    "EDIT_LEADS",
    "EXPORT_LEADS",
    "MANAGE_CRM",
    "CREATE_CAMPAIGN",
    "MANAGE_TEMPLATES",
    "VIEW_ANALYTICS",
  ],
};

/**
 * Resolves a member's effective permissions.
 *
 * `overrideJson` is the raw `TenantMember.permissions` column. Unparseable or
 * non-array content falls back to the role defaults rather than to an empty
 * set: a corrupted column should not silently strip a member's access, and it
 * should certainly not grant any.
 */
export function resolvePermissions(
  role: string,
  overrideJson?: string | null
): Set<Permission> {
  const effectiveRole: TenantRole = isTenantRole(role) ? role : "member";

  if (overrideJson) {
    try {
      const parsed = JSON.parse(overrideJson);
      if (Array.isArray(parsed)) {
        // Unknown strings are dropped rather than trusted, so a permission
        // renamed in a later release cannot grant something unintended.
        const allowed = parsed.filter(isPermission);
        return new Set(allowed);
      }
    } catch {
      // fall through to role defaults
    }
  }

  return new Set(ROLE_PERMISSIONS[effectiveRole]);
}

/** Serializes a permission override for storage. Returns null for "use defaults". */
export function serializePermissions(permissions: Permission[] | null | undefined): string | null {
  if (!permissions) return null;
  const unique = Array.from(new Set(permissions.filter(isPermission)));
  return JSON.stringify(unique);
}

export function hasPermission(granted: Set<Permission>, required: Permission): boolean {
  return granted.has(required);
}
