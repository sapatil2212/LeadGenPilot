-- Campaign review-and-send workflow. These tables were previously introduced
-- with `prisma db push`; this committed migration is the canonical schema for
-- every clean environment going forward.

-- CreateTable
CREATE TABLE IF NOT EXISTS `campaigns` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending_review',
    `icp_profile_id` VARCHAR(191) NULL,
    `source_type` VARCHAR(191) NOT NULL,
    `source_list_id` VARCHAR(191) NULL,
    `filters` TEXT NULL,
    `channels` TEXT NOT NULL,
    `templates` TEXT NULL,
    `ai_provider` VARCHAR(191) NULL,
    `ai_model` VARCHAR(191) NULL,
    `prompt_name` VARCHAR(191) NULL,
    `prompt_version` INTEGER NULL,
    `total_messages` INTEGER NOT NULL DEFAULT 0,
    `pending_count` INTEGER NOT NULL DEFAULT 0,
    `approved_count` INTEGER NOT NULL DEFAULT 0,
    `rejected_count` INTEGER NOT NULL DEFAULT 0,
    `sent_count` INTEGER NOT NULL DEFAULT 0,
    `failed_count` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `userId` VARCHAR(191) NULL,

    CONSTRAINT `campaigns_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `campaigns_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX `campaigns_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `campaigns_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `campaigns_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `campaign_messages` (
    `id` VARCHAR(191) NOT NULL,
    `campaign_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `lead_id` VARCHAR(191) NULL,
    `business_name` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `subject` TEXT NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending_review',
    `rejection_reason` TEXT NULL,
    `error_message` TEXT NULL,
    `ai_provider` VARCHAR(191) NULL,
    `ai_model` VARCHAR(191) NULL,
    `prompt_name` VARCHAR(191) NULL,
    `prompt_version` INTEGER NULL,
    `tokens_used` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `approved_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `external_message_id` VARCHAR(191) NULL,

    CONSTRAINT `campaign_messages_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `campaign_messages_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `campaign_messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX `campaign_messages_campaign_id_status_idx`(`campaign_id`, `status`),
    INDEX `campaign_messages_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `campaign_messages_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Reconcile deployments where the Phase 5 tables were created by `db push`
-- before this migration was committed. Fresh databases already get this column
-- from CREATE TABLE above; existing databases add it exactly once.
SET @campaign_message_id_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_messages'
      AND COLUMN_NAME = 'external_message_id'
);
SET @campaign_message_id_statement := IF(
    @campaign_message_id_column_exists = 0,
    'ALTER TABLE `campaign_messages` ADD COLUMN `external_message_id` VARCHAR(191) NULL',
    'SELECT 1'
);
PREPARE campaign_message_id_statement FROM @campaign_message_id_statement;
EXECUTE campaign_message_id_statement;
DEALLOCATE PREPARE campaign_message_id_statement;
