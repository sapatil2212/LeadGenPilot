-- Billing and platform-operations tables for the superadmin console.
--
-- Purely additive: seven new tables, one new column on `users` with a default,
-- and two new indexes. No existing column is altered or dropped, so every
-- current reader and writer keeps working unchanged and the migration is safe
-- to apply while the application is running.
--
-- `users`.`status` defaults to 'active', which is the correct value for every
-- pre-existing row: nobody has been suspended yet.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX `users_status_idx` ON `users`(`status`);

-- CreateIndex
CREATE INDEX `users_plan_idx` ON `users`(`plan`);

-- CreateTable
CREATE TABLE `plan_definitions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `price_monthly` INTEGER NOT NULL DEFAULT 0,
    `price_yearly` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `monthly_lead_limit` INTEGER NOT NULL DEFAULT 100,
    `seats` INTEGER NOT NULL DEFAULT 1,
    `trial_days` INTEGER NOT NULL DEFAULT 0,
    `features` TEXT NULL,
    `highlight` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_public` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plan_definitions_key_key`(`key`),
    INDEX `plan_definitions_is_active_idx`(`is_active`),
    INDEX `plan_definitions_sort_order_idx`(`sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NULL,
    `plan_key` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `billing_cycle` VARCHAR(191) NOT NULL DEFAULT 'monthly',
    `amount` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `seats` INTEGER NOT NULL DEFAULT 1,
    `discount_percent` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `current_period_start` DATETIME(3) NOT NULL,
    `current_period_end` DATETIME(3) NOT NULL,
    `trial_ends_at` DATETIME(3) NULL,
    `cancel_at_period_end` BOOLEAN NOT NULL DEFAULT false,
    `canceled_at` DATETIME(3) NULL,
    `cancel_reason` TEXT NULL,
    `external_ref` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscriptions_user_id_idx`(`user_id`),
    INDEX `subscriptions_tenant_id_idx`(`tenant_id`),
    INDEX `subscriptions_status_idx`(`status`),
    INDEX `subscriptions_plan_key_idx`(`plan_key`),
    INDEX `subscriptions_current_period_end_idx`(`current_period_end`),
    INDEX `subscriptions_status_current_period_end_idx`(`status`, `current_period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `tenant_id` VARCHAR(191) NULL,
    `subscription_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `subtotal` INTEGER NOT NULL DEFAULT 0,
    `discount` INTEGER NOT NULL DEFAULT 0,
    `tax_percent` INTEGER NOT NULL DEFAULT 0,
    `tax` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `amount_paid` INTEGER NOT NULL DEFAULT 0,
    `line_items` TEXT NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `due_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `period_start` DATETIME(3) NULL,
    `period_end` DATETIME(3) NULL,
    `billing_name` VARCHAR(191) NULL,
    `billing_email` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_number_key`(`number`),
    INDEX `invoices_user_id_idx`(`user_id`),
    INDEX `invoices_tenant_id_idx`(`tenant_id`),
    INDEX `invoices_subscription_id_idx`(`subscription_id`),
    INDEX `invoices_status_idx`(`status`),
    INDEX `invoices_issued_at_idx`(`issued_at`),
    INDEX `invoices_due_at_idx`(`due_at`),
    INDEX `invoices_status_due_at_idx`(`status`, `due_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NULL,
    `user_id` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `status` VARCHAR(191) NOT NULL DEFAULT 'succeeded',
    `method` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `gateway` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `failure_reason` TEXT NULL,
    `refunded_amount` INTEGER NOT NULL DEFAULT 0,
    `paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payments_invoice_id_idx`(`invoice_id`),
    INDEX `payments_user_id_idx`(`user_id`),
    INDEX `payments_status_idx`(`status`),
    INDEX `payments_method_idx`(`method`),
    INDEX `payments_paid_at_idx`(`paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `rollout_percent` INTEGER NOT NULL DEFAULT 100,
    `audience` VARCHAR(191) NOT NULL DEFAULT 'all',
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `feature_flags_key_key`(`key`),
    INDEX `feature_flags_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `level` VARCHAR(191) NOT NULL DEFAULT 'info',
    `audience` VARCHAR(191) NOT NULL DEFAULT 'all',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `published_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `announcements_is_active_idx`(`is_active`),
    INDEX `announcements_published_at_idx`(`published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_settings` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'general',
    `label` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `updated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_settings_key_key`(`key`),
    INDEX `platform_settings_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
