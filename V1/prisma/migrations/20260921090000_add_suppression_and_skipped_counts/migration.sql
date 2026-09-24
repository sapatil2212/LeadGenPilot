-- AlterTable
ALTER TABLE `campaigns` ADD COLUMN `skipped_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `suppression_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `contact_key` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `source` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `suppression_entries_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    UNIQUE INDEX `suppression_entries_tenant_id_channel_contact_key_key`(`tenant_id`, `channel`, `contact_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `suppression_entries` ADD CONSTRAINT `suppression_entries_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
