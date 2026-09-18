/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backfills the tenancy columns added by the add_tenancy_and_jobs migration.
 *
 * For every user: create a workspace with that user as owner (if they have none),
 * then stamp tenant_id onto the rows they already own — lead lists, leads,
 * integrations and audit entries.
 *
 * Idempotent: re-running only touches rows that are still unstamped, so it can
 * be run again after restoring a backup or after adding users.
 *
 * The live database is currently empty, so this is a no-op today. It exists
 * because the data it migrates does exist — in the previous `nexaleadai`
 * database and in the Phase 0 backup — and whoever restores either one needs
 * this to run before tenant-scoped reads will see anything.
 *
 * Usage
 *   node scripts/backfill-tenants.mjs             # dry run
 *   node scripts/backfill-tenants.mjs --confirm   # apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const confirm = process.argv.includes("--confirm");

function slugify(input) {
  const base = String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

async function allocateSlug(desired) {
  const base = slugify(desired);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function tenantName(user) {
  if (user.name && user.name.trim()) return `${user.name.trim()}'s Workspace`;
  const local = String(user.email || "").split("@")[0] || "My";
  return `${local}'s Workspace`;
}

const summary = {
  users: 0,
  tenantsCreated: 0,
  membershipsCreated: 0,
  leadLists: 0,
  leads: 0,
  leadsViaList: 0,
  integrations: 0,
  auditLogs: 0,
};

try {
  console.log(`Mode: ${confirm ? "APPLY" : "DRY RUN (pass --confirm to write)"}\n`);

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  summary.users = users.length;

  if (users.length === 0) {
    console.log("No users found. Nothing to backfill.");
  }

  for (const user of users) {
    // ── workspace ──
    let membership = await prisma.tenantMember.findFirst({
      where: { userId: user.id },
      select: { tenantId: true },
      orderBy: { createdAt: "asc" },
    });

    let tenantId = membership?.tenantId ?? null;

    if (!tenantId) {
      const name = tenantName(user);
      if (confirm) {
        const slug = await allocateSlug(name);
        tenantId = await prisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({ data: { name, slug } });
          await tx.tenantMember.create({
            data: { tenantId: tenant.id, userId: user.id, role: "owner", status: "active" },
          });
          return tenant.id;
        });
      } else {
        tenantId = "<would-be-created>";
      }
      summary.tenantsCreated++;
      summary.membershipsCreated++;
      console.log(`  user ${user.id}: create workspace "${name}"`);
    } else {
      console.log(`  user ${user.id}: already in workspace ${tenantId}`);
    }

    if (!confirm) continue;

    // ── owned rows ──
    const lists = await prisma.leadList.updateMany({
      where: { userId: user.id, tenantId: null },
      data: { tenantId },
    });
    summary.leadLists += lists.count;

    const leads = await prisma.lead.updateMany({
      where: { userId: user.id, tenantId: null },
      data: { tenantId },
    });
    summary.leads += leads.count;

    const integrations = await prisma.userIntegration.updateMany({
      where: { userId: user.id, tenantId: null },
      data: { tenantId },
    });
    summary.integrations += integrations.count;

    const audit = await prisma.auditLog.updateMany({
      where: { userId: user.id, tenantId: null },
      data: { tenantId },
    });
    summary.auditLogs += audit.count;
  }

  /*
   * Leads whose own user_id was never set still belong to a workspace through
   * their list, which is the authoritative parent. Attribute them from the list
   * so nothing is left unreachable.
   */
  if (confirm) {
    const orphanLeadLists = await prisma.leadList.findMany({
      where: { tenantId: { not: null } },
      select: { id: true, tenantId: true },
    });
    for (const list of orphanLeadLists) {
      const res = await prisma.lead.updateMany({
        where: { listId: list.id, tenantId: null },
        data: { tenantId: list.tenantId },
      });
      summary.leadsViaList += res.count;
    }
  }

  // ── report what remains unattributable ──
  const remaining = {
    leadLists: await prisma.leadList.count({ where: { tenantId: null } }),
    leads: await prisma.lead.count({ where: { tenantId: null } }),
    integrations: await prisma.userIntegration.count({ where: { tenantId: null } }),
    usersWithoutWorkspace: await prisma.user.count({ where: { memberships: { none: {} } } }),
  };

  console.log("\nSummary");
  console.log(`  users seen              ${summary.users}`);
  console.log(`  workspaces created      ${summary.tenantsCreated}`);
  console.log(`  owner memberships       ${summary.membershipsCreated}`);
  console.log(`  lead lists stamped      ${summary.leadLists}`);
  console.log(`  leads stamped by user   ${summary.leads}`);
  console.log(`  leads stamped by list   ${summary.leadsViaList}`);
  console.log(`  integrations stamped    ${summary.integrations}`);
  console.log(`  audit entries stamped   ${summary.auditLogs}`);

  console.log("\nRemaining without a workspace");
  console.log(`  lead lists              ${remaining.leadLists}`);
  console.log(`  leads                   ${remaining.leads}`);
  console.log(`  integrations            ${remaining.integrations}`);
  console.log(`  users                   ${remaining.usersWithoutWorkspace}`);

  if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to write.");
  } else {
    const stranded =
      remaining.leadLists + remaining.leads + remaining.integrations + remaining.usersWithoutWorkspace;
    if (stranded === 0) {
      console.log("\nOK: every row is attributed to a workspace.");
    } else {
      // A lead list with a null user_id predates ownership tracking and cannot
      // be attributed automatically. Reported rather than guessed.
      console.log(
        "\nWARNING: the rows above could not be attributed automatically — they have no owning user. " +
          "Assign them manually, or leave them: tenant-scoped reads will not return them."
      );
      process.exitCode = 1;
    }
  }
} catch (err) {
  console.error(`\nBackfill failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
