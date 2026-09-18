-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `email_verified` BOOLEAN NOT NULL DEFAULT false,
    `role` VARCHAR(191) NOT NULL DEFAULT 'user',
    `plan` VARCHAR(191) NOT NULL DEFAULT 'free',
    `leads_used` INTEGER NOT NULL DEFAULT 0,
    `usage_period` VARCHAR(191) NULL,
    `failed_login_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_integrations` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `config` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `label` VARCHAR(191) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_integrations_user_id_idx`(`user_id`),
    INDEX `user_integrations_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `user_agent` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` VARCHAR(191) NULL,

    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_otps` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `code_hash` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'verify',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumed` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` VARCHAR(191) NULL,

    INDEX `email_otps_email_idx`(`email`),
    INDEX `email_otps_expires_at_idx`(`expires_at`),
    INDEX `email_otps_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_lists` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `business_type` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `scraped_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `user_id` VARCHAR(191) NULL,

    INDEX `lead_lists_user_id_idx`(`user_id`),
    INDEX `lead_lists_scraped_at_idx`(`scraped_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `business_name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL DEFAULT '',
    `address` TEXT NOT NULL,
    `rating` DOUBLE NOT NULL DEFAULT 0,
    `reviews` INTEGER NOT NULL DEFAULT 0,
    `website` TEXT NOT NULL,
    `maps_url` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT '',
    `website_missing` BOOLEAN NOT NULL DEFAULT false,
    `lead_score` INTEGER NOT NULL DEFAULT 0,
    `date_added` VARCHAR(191) NOT NULL,
    `website_status` VARCHAR(191) NOT NULL DEFAULT 'MISSING',
    `instagram_url` TEXT NOT NULL,
    `instagram_status` VARCHAR(191) NOT NULL DEFAULT 'NOT_FOUND',
    `instagram_last_post` VARCHAR(191) NOT NULL DEFAULT '',
    `facebook_url` TEXT NOT NULL,
    `facebook_status` VARCHAR(191) NOT NULL DEFAULT 'NOT_FOUND',
    `facebook_last_post` VARCHAR(191) NOT NULL DEFAULT '',
    `whatsapp_present` BOOLEAN NOT NULL DEFAULT false,
    `appointment_system` BOOLEAN NOT NULL DEFAULT false,
    `lead_priority` VARCHAR(191) NOT NULL DEFAULT 'COLD',
    `ai_insight` TEXT NOT NULL,
    `emails` TEXT NOT NULL,
    `linkedin_url` TEXT NOT NULL,
    `linkedin_status` VARCHAR(191) NOT NULL DEFAULT 'NOT_FOUND',
    `google_analytics_present` BOOLEAN NOT NULL DEFAULT false,
    `meta_pixel_present` BOOLEAN NOT NULL DEFAULT false,
    `email_status` VARCHAR(191) NULL,
    `email_sent_date` VARCHAR(191) NULL,
    `whatsapp_status` VARCHAR(191) NULL,
    `whatsapp_sent_date` VARCHAR(191) NULL,
    `conversation_status` VARCHAR(191) NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `notes` TEXT NULL,
    `list_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leads_list_id_idx`(`list_id`),
    INDEX `leads_user_id_idx`(`user_id`),
    INDEX `leads_lead_priority_idx`(`lead_priority`),
    INDEX `leads_lead_score_idx`(`lead_score`),
    INDEX `leads_date_added_idx`(`date_added`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `page_views` (
    `id` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `user_agent` TEXT NULL,
    `referrer` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `page_views_path_idx`(`path`),
    INDEX `page_views_created_at_idx`(`created_at`),
    INDEX `page_views_ip_idx`(`ip`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_integrations` ADD CONSTRAINT `user_integrations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_otps` ADD CONSTRAINT `email_otps_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_lists` ADD CONSTRAINT `lead_lists_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_list_id_fkey` FOREIGN KEY (`list_id`) REFERENCES `lead_lists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

