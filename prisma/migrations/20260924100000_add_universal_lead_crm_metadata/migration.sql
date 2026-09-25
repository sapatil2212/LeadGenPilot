-- Add universal, industry-agnostic CRM metadata without removing legacy
-- discovery/audit columns. Defaults keep all existing writers compatible.
ALTER TABLE `leads`
    ADD COLUMN `contact_name` VARCHAR(191) NULL,
    ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'GOOGLE_MAPS',
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    ADD COLUMN `assigned_user_id` VARCHAR(191) NULL,
    ADD COLUMN `tags` TEXT NULL,
    ADD COLUMN `custom_fields` TEXT NULL,
    ADD COLUMN `product_fit` TEXT NULL,
    ADD COLUMN `service_fit` TEXT NULL;

-- Preserve the best available provenance and lifecycle for existing rows.
UPDATE `leads`
SET `source` = CASE
        WHEN NULLIF(TRIM(`maps_url`), '') IS NOT NULL THEN 'GOOGLE_MAPS'
        ELSE 'IMPORTED'
    END,
    `status` = CASE
        WHEN `conversation_status` = 'REPLIED' THEN 'REPLIED'
        WHEN `email_status` = 'SENT' OR `whatsapp_status` = 'SENT' THEN 'CONTACTED'
        ELSE 'NEW'
    END;

CREATE INDEX `leads_tenant_id_source_idx` ON `leads`(`tenant_id`, `source`);
CREATE INDEX `leads_tenant_id_status_idx` ON `leads`(`tenant_id`, `status`);
CREATE INDEX `leads_tenant_id_assigned_user_id_idx` ON `leads`(`tenant_id`, `assigned_user_id`);

ALTER TABLE `leads`
    ADD CONSTRAINT `leads_assigned_user_id_fkey`
    FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
