#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [
    users,
    activeTenants,
    usersWithoutWorkspace,
    leadLists,
    leadListsWithoutTenant,
    leads,
    leadsWithoutTenant,
    ownershipMismatches,
    duplicatePhones,
    integrations,
    integrationsWithoutTenant,
    phoneColumns,
    phoneIndexes,
    migrationRows,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.tenant.count({ where: { status: "active" } }),
    prisma.user.count({ where: { memberships: { none: { status: "active" } } } }),
    prisma.leadList.count(),
    prisma.leadList.count({ where: { tenantId: null } }),
    prisma.lead.count(),
    prisma.lead.count({ where: { tenantId: null } }),
    prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS count FROM leads l INNER JOIN lead_lists ll ON ll.id = l.list_id WHERE l.tenant_id IS NOT NULL AND ll.tenant_id IS NOT NULL AND l.tenant_id <> ll.tenant_id"
    ),
    prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS count FROM (SELECT phone FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1) duplicates"
    ),
    prisma.userIntegration.count(),
    prisma.userIntegration.count({ where: { tenantId: null } }),
    prisma.$queryRawUnsafe(
      "SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = 'users' AND COLUMN_NAME IN ('phone','phone_verified')) OR (TABLE_NAME = 'email_otps' AND COLUMN_NAME IN ('email','phone'))) ORDER BY TABLE_NAME, COLUMN_NAME"
    ),
    prisma.$queryRawUnsafe(
      "SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_otps' AND COLUMN_NAME = 'phone'"
    ),
    prisma.$queryRawUnsafe(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name IN ('20260919160000_add_phone_verification','20260919163000_unique_user_phone')"
    ),
  ]);

  const mismatchCount = Number(ownershipMismatches?.[0]?.count || 0);
  const duplicatePhoneCount = Number(duplicatePhones?.[0]?.count || 0);
  const nullableByColumn = new Map(phoneColumns.map((column) => [`${column.TABLE_NAME}.${column.COLUMN_NAME}`, column.IS_NULLABLE]));
  const migrationsComplete = migrationRows.length === 2 && migrationRows.every((row) => row.finished_at && !row.rolled_back_at);
  const healthy =
    usersWithoutWorkspace === 0 &&
    leadListsWithoutTenant === 0 &&
    leadsWithoutTenant === 0 &&
    mismatchCount === 0 &&
    duplicatePhoneCount === 0 &&
    integrationsWithoutTenant === 0 &&
    phoneColumns.length === 4 &&
    nullableByColumn.get("email_otps.email") === "YES" &&
    nullableByColumn.get("email_otps.phone") === "YES" &&
    nullableByColumn.get("users.phone") === "YES" &&
    nullableByColumn.get("users.phone_verified") === "NO" &&
    phoneIndexes.length > 0 &&
    migrationsComplete;

  console.log(JSON.stringify({
    healthy,
    users,
    activeTenants,
    usersWithoutWorkspace,
    leadLists,
    leadListsWithoutTenant,
    leads,
    leadsWithoutTenant,
    leadListTenantMismatches: mismatchCount,
    duplicatePhoneCount,
    integrations,
    integrationsWithoutTenant,
    phoneSchema: {
      columns: phoneColumns,
      indexes: phoneIndexes,
      migrationsComplete,
    },
  }, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));

  if (!healthy) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
