/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only tenant-ownership audit.
 *
 * Answers two questions the tenant-isolation work depends on:
 *   1. Does every lead list and lead have an owner? An orphan row (userId null)
 *      is invisible to every tenant once queries are scoped by owner.
 *   2. Does the ownership predicate the CRM routes now use reach all the data?
 *      Any shortfall means a scoping change made records unreachable.
 *
 * Issues only counts and id selects. No writes, no DDL.
 *
 * Usage: node scripts/verify-tenant-ownership.mjs
 * Exits 0 when everything reconciles, 1 otherwise, so it can gate a release.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Users: ${users.length}`);

  let reachableLeads = 0;
  let reachableLists = 0;

  for (const user of users) {
    const lists = await prisma.leadList.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const listIds = lists.map((l) => l.id);
    const leads = listIds.length
      ? await prisma.lead.count({ where: { listId: { in: listIds } } })
      : 0;

    reachableLists += lists.length;
    reachableLeads += leads;

    // Emails are shown truncated: this output tends to end up in tickets.
    const who = `${user.email.slice(0, 3)}***@${user.email.split("@")[1] ?? "?"}`;
    console.log(
      `  ${user.id}  ${who.padEnd(24)} role=${user.role.padEnd(5)} ` +
        `${String(lists.length).padStart(3)} list(s)  ${String(leads).padStart(5)} lead(s)`
    );
  }

  const totalLists = await prisma.leadList.count();
  const totalLeads = await prisma.lead.count();
  const orphanLists = await prisma.leadList.count({ where: { userId: null } });
  const orphanLeads = await prisma.lead.count({ where: { userId: null } });

  console.log("");
  console.log(`Lists  total=${totalLists}  reachable-by-owner=${reachableLists}  orphaned=${orphanLists}`);
  console.log(`Leads  total=${totalLeads}  reachable-by-owner=${reachableLeads}  orphaned=${orphanLeads}`);

  const problems = [];
  if (orphanLists > 0) problems.push(`${orphanLists} lead list(s) have no owner`);
  if (orphanLeads > 0) problems.push(`${orphanLeads} lead(s) have a null userId column`);
  if (reachableLists !== totalLists) {
    problems.push(`${totalLists - reachableLists} list(s) are not reachable by any owner`);
  }
  if (reachableLeads !== totalLeads) {
    problems.push(`${totalLeads - reachableLeads} lead(s) are not reachable through an owned list`);
  }

  console.log("");
  if (problems.length === 0) {
    console.log("OK: every list and lead is reachable by its owner under tenant-scoped queries.");
  } else {
    console.log("PROBLEMS FOUND:");
    problems.forEach((p) => console.log(`  - ${p}`));
    console.log("These rows would become invisible once queries are scoped by owner.");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`Ownership audit failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
