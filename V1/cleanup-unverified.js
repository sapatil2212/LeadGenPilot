/**
 * Manual Cleanup Script for Unverified Users
 * Run this manually: node cleanup-unverified.js
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Checking for unverified users older than 10 minutes...\n");

  const cutoffTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

  // First, list users that will be deleted
  const usersToDelete = await prisma.user.findMany({
    where: {
      emailVerified: false,
      createdAt: {
        lt: cutoffTime,
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  if (usersToDelete.length === 0) {
    console.log("✅ No unverified users found older than 10 minutes.");
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`Found ${usersToDelete.length} unverified user(s) to delete:\n`);
  usersToDelete.forEach((user, index) => {
    const age = Math.round((Date.now() - user.createdAt.getTime()) / 60000);
    console.log(`${index + 1}. ${user.email} (${user.name || "No name"})`);
    console.log(`   Created: ${user.createdAt.toLocaleString()}`);
    console.log(`   Age: ${age} minutes old\n`);
  });

  // Delete unverified users
  const result = await prisma.user.deleteMany({
    where: {
      emailVerified: false,
      createdAt: {
        lt: cutoffTime,
      },
    },
  });

  console.log(`✅ Successfully deleted ${result.count} unverified user(s).\n`);

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
