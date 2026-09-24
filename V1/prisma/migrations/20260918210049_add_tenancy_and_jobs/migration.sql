-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `tenant_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `lead_lists` ADD COLUMN `tenant_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `leads` ADD COLUMN `tenant_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `user_integrations` ADD COLUMN `tenant_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `tenants` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    INDEX `tenants_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_members` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `permissions` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `invited_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tenant_members_user_id_idx`(`user_id`),
    INDEX `tenant_members_tenant_id_role_idx`(`tenant_id`, `role`),
    INDEX `tenant_members_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `tenant_members_tenant_id_user_id_key`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `params` TEXT NULL,
    `progress` TEXT NULL,
    `result` TEXT NULL,
    `error` TEXT NULL,
    `cancel_requested_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `jobs_tenant_id_kind_status_idx`(`tenant_id`, `kind`, `status`),
    INDEX `jobs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `jobs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `audit_logs_tenant_id_created_at_idx` ON `audit_logs`(`tenant_id`, `created_at`);

-- CreateIndex
CREATE INDEX `lead_lists_tenant_id_idx` ON `lead_lists`(`tenant_id`);

-- CreateIndex
CREATE INDEX `lead_lists_tenant_id_scraped_at_idx` ON `lead_lists`(`tenant_id`, `scraped_at`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_idx` ON `leads`(`tenant_id`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_lead_score_idx` ON `leads`(`tenant_id`, `lead_score`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_lead_priority_idx` ON `leads`(`tenant_id`, `lead_priority`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_created_at_idx` ON `leads`(`tenant_id`, `created_at`);

-- CreateIndex
CREATE INDEX `user_integrations_tenant_id_type_idx` ON `user_integrations`(`tenant_id`, `type`);

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_integrations` ADD CONSTRAINT `user_integrations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_lists` ADD CONSTRAINT `lead_lists_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

