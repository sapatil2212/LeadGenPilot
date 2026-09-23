-- CreateTable
CREATE TABLE `outreach_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by_id` VARCHAR(191) NOT NULL,
    `updated_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `outreach_templates_tenant_id_channel_status_idx`(`tenant_id`, `channel`, `status`),
    INDEX `outreach_templates_tenant_id_updated_at_idx`(`tenant_id`, `updated_at`),
    INDEX `outreach_templates_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `outreach_templates` ADD CONSTRAINT `outreach_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
