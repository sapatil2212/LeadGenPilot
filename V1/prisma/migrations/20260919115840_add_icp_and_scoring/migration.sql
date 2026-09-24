-- AlterTable
ALTER TABLE `lead_lists` ADD COLUMN `icp_profile_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `leads` ADD COLUMN `icp_fit_reason` TEXT NULL,
    ADD COLUMN `icp_fit_score` INTEGER NULL,
    ADD COLUMN `icp_profile_id` VARCHAR(191) NULL,
    ADD COLUMN `score_breakdown` TEXT NULL,
    ADD COLUMN `score_max` INTEGER NULL,
    ADD COLUMN `scored_at` DATETIME(3) NULL,
    ADD COLUMN `scoring_rule_set_id` VARCHAR(191) NULL,
    ADD COLUMN `scoring_version` INTEGER NULL;

-- CreateTable
CREATE TABLE `icp_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `target_categories` TEXT NULL,
    `target_industries` TEXT NULL,
    `target_locations` TEXT NULL,
    `decision_maker_roles` TEXT NULL,
    `exclude_categories` TEXT NULL,
    `exclude_keywords` TEXT NULL,
    `required_signals` TEXT NULL,
    `preferred_signals` TEXT NULL,
    `min_rating` DOUBLE NULL,
    `min_reviews` INTEGER NULL,
    `max_results` INTEGER NOT NULL DEFAULT 50,
    `radius_km` DOUBLE NULL,
    `deep_analysis` BOOLEAN NOT NULL DEFAULT false,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `ai_confidence` DOUBLE NULL,
    `last_suggested_at` DATETIME(3) NULL,
    `last_prompt_name` VARCHAR(191) NULL,
    `last_prompt_version` INTEGER NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `icp_profiles_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `icp_profiles_tenant_id_is_default_idx`(`tenant_id`, `is_default`),
    INDEX `icp_profiles_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scoring_rule_sets` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `rules` TEXT NOT NULL,
    `hot_threshold` DOUBLE NOT NULL DEFAULT 0.58,
    `warm_threshold` DOUBLE NOT NULL DEFAULT 0.35,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_built_in` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scoring_rule_sets_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `scoring_rule_sets_tenant_id_is_default_idx`(`tenant_id`, `is_default`),
    INDEX `scoring_rule_sets_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `discovered_businesses` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `business_name` VARCHAR(191) NOT NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `lead_id` VARCHAR(191) NULL,
    `times_seen` INTEGER NOT NULL DEFAULT 1,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `discovered_businesses_tenant_id_last_seen_at_idx`(`tenant_id`, `last_seen_at`),
    UNIQUE INDEX `discovered_businesses_tenant_id_fingerprint_key`(`tenant_id`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `lead_lists_icp_profile_id_idx` ON `lead_lists`(`icp_profile_id`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_scoring_rule_set_id_idx` ON `leads`(`tenant_id`, `scoring_rule_set_id`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_icp_fit_score_idx` ON `leads`(`tenant_id`, `icp_fit_score`);

-- AddForeignKey
ALTER TABLE `lead_lists` ADD CONSTRAINT `lead_lists_icp_profile_id_fkey` FOREIGN KEY (`icp_profile_id`) REFERENCES `icp_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `icp_profiles` ADD CONSTRAINT `icp_profiles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `icp_profiles` ADD CONSTRAINT `icp_profiles_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scoring_rule_sets` ADD CONSTRAINT `scoring_rule_sets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scoring_rule_sets` ADD CONSTRAINT `scoring_rule_sets_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discovered_businesses` ADD CONSTRAINT `discovered_businesses_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

