-- Tenant-scoped inbox and delivery reporting. New tables intentionally start
-- empty: legacy JSON records have no trustworthy workspace ownership.

CREATE TABLE `conversation_threads` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `contact_key` VARCHAR(191) NOT NULL,
    `lead_id` VARCHAR(191) NULL,
    `business_name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'AWAITING_REPLY',
    `unread_count` INTEGER NOT NULL DEFAULT 0,
    `last_message_at` DATETIME(3) NOT NULL,
    `last_message_preview` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `conversation_threads_tenant_id_channel_contact_key_key`(`tenant_id`, `channel`, `contact_key`),
    INDEX `conversation_threads_tenant_id_last_message_at_idx`(`tenant_id`, `last_message_at`),
    INDEX `conversation_threads_tenant_id_status_last_message_at_idx`(`tenant_id`, `status`, `last_message_at`),
    INDEX `conversation_threads_lead_id_idx`(`lead_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `conversation_threads_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `conversation_threads_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `conversation_messages` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `thread_id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `source` VARCHAR(191) NULL,
    `provider` VARCHAR(191) NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `conversation_messages_tenant_id_provider_message_id_key`(`tenant_id`, `provider_message_id`),
    INDEX `conversation_messages_thread_id_occurred_at_idx`(`thread_id`, `occurred_at`),
    INDEX `conversation_messages_tenant_id_occurred_at_idx`(`tenant_id`, `occurred_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `conversation_messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `conversation_messages_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `campaign_dispatches` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `campaign_id` VARCHAR(191) NULL,
    `campaign_message_id` VARCHAR(191) NULL,
    `lead_id` VARCHAR(191) NULL,
    `business_name` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `source_type` VARCHAR(191) NOT NULL,
    `source_label` VARCHAR(191) NOT NULL,
    `dry_run` BOOLEAN NOT NULL DEFAULT false,
    `subject` TEXT NULL,
    `message_snippet` TEXT NULL,
    `error_message` TEXT NULL,
    `external_message_id` VARCHAR(191) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaign_dispatches_tenant_id_occurred_at_idx`(`tenant_id`, `occurred_at`),
    INDEX `campaign_dispatches_tenant_id_channel_status_occurred_at_idx`(`tenant_id`, `channel`, `status`, `occurred_at`),
    INDEX `campaign_dispatches_campaign_id_occurred_at_idx`(`campaign_id`, `occurred_at`),
    INDEX `campaign_dispatches_lead_id_idx`(`lead_id`),
    INDEX `campaign_dispatches_tenant_id_external_message_id_idx`(`tenant_id`, `external_message_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `campaign_dispatches_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `campaign_dispatches_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `campaign_dispatches_campaign_message_id_fkey` FOREIGN KEY (`campaign_message_id`) REFERENCES `campaign_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `campaign_dispatches_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
