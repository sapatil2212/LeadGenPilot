-- Migration: add_message_templates
--
-- Adds the MessageTemplate model: a component-based WhatsApp message template
-- that renders into either a WhatsApp Web plain-text message or a Meta Cloud
-- API template submission from a single structured JSON payload.
--
-- Sits alongside outreach_templates (which continues to serve email). All
-- columns either have defaults or are nullable, so this migration is additive
-- and cannot affect existing data.

CREATE TABLE `message_templates` (
  `id`              VARCHAR(191) NOT NULL,
  `tenant_id`       VARCHAR(191) NOT NULL,
  `name`            VARCHAR(191) NOT NULL,
  `description`     TEXT         NULL,
  `category`        VARCHAR(191) NOT NULL DEFAULT 'marketing' COMMENT 'marketing|sales|utility|support|custom',
  `language`        VARCHAR(191) NOT NULL DEFAULT 'en'        COMMENT 'ISO 639-1 language code',
  `channel`         VARCHAR(191) NOT NULL DEFAULT 'whatsapp'  COMMENT 'whatsapp (extensible)',
  `delivery_method` VARCHAR(191) NOT NULL DEFAULT 'web'       COMMENT 'web|cloud_api',
  `tags`            TEXT         NULL                         COMMENT 'JSON string array of labels',
  `payload`         LONGTEXT     NOT NULL                     COMMENT 'Component-based builder payload as JSON',
  `status`          VARCHAR(191) NOT NULL DEFAULT 'draft'     COMMENT 'draft|active|archived',
  `version`         INT          NOT NULL DEFAULT 1,
  `usage_count`     INT          NOT NULL DEFAULT 0,
  `is_prebuilt`     BOOLEAN      NOT NULL DEFAULT false,
  `created_by_id`   VARCHAR(191) NOT NULL,
  `updated_by_id`   VARCHAR(191) NOT NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `message_templates_tenant_id_category_status_idx`
  ON `message_templates` (`tenant_id`, `category`, `status`);
CREATE INDEX `message_templates_tenant_id_channel_status_idx`
  ON `message_templates` (`tenant_id`, `channel`, `status`);
CREATE INDEX `message_templates_tenant_id_delivery_method_status_idx`
  ON `message_templates` (`tenant_id`, `delivery_method`, `status`);
CREATE INDEX `message_templates_tenant_id_updated_at_idx`
  ON `message_templates` (`tenant_id`, `updated_at`);
CREATE INDEX `message_templates_created_by_id_idx`
  ON `message_templates` (`created_by_id`);

ALTER TABLE `message_templates`
  ADD CONSTRAINT `message_templates_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
