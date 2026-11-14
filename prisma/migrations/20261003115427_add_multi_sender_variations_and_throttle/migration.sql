-- Migration: add_multi_sender_variations_and_throttle
--
-- Adds:
--   1. Campaign-level outreach throttle settings (messageDelayMin, messageDelayMax,
--      batchSize, batchPauseSeconds) with safe defaults that preserve existing behaviour.
--   2. Campaign-level sender and template rotation state (senderRotationIndex,
--      templateRotationIndex) persisted as DB integers for concurrency-safe atomic
--      increments.
--   3. CampaignMessage-level sender tracking (selectedSenderId) so retries reuse
--      the same sender that was originally chosen.
--   4. TemplateVariation model for AI-generated message variants that rotate per lead.
--   5. CampaignDispatch analytics columns for sender and variation tracking.
--
-- All new columns are nullable or have defaults, guaranteeing existing campaigns
-- continue to work without schema changes or manual migration steps.

-- ── Campaign throttle + rotation ─────────────────────────────────────────────

ALTER TABLE `campaigns`
  ADD COLUMN `message_delay_min`      INT     NOT NULL DEFAULT 40    COMMENT 'Minimum send delay in seconds (random floor)',
  ADD COLUMN `message_delay_max`      INT     NOT NULL DEFAULT 100   COMMENT 'Maximum send delay in seconds (random ceiling)',
  ADD COLUMN `batch_size`             INT     NOT NULL DEFAULT 25    COMMENT 'Messages per batch before pausing',
  ADD COLUMN `batch_pause_seconds`    INT     NOT NULL DEFAULT 60    COMMENT 'Pause duration in seconds between batches',
  ADD COLUMN `sender_rotation_index`  INT     NOT NULL DEFAULT 0     COMMENT 'Next sender slot index (0-based, wraps)',
  ADD COLUMN `template_rotation_index` INT    NOT NULL DEFAULT 0     COMMENT 'Next template variation index (0-based, wraps)';

-- ── CampaignMessage sender tracking ──────────────────────────────────────────

ALTER TABLE `campaign_messages`
  ADD COLUMN `selected_sender_id` VARCHAR(191) NULL COMMENT 'UserIntegration.id of the sender used for this message';

CREATE INDEX `campaign_messages_selected_sender_id_idx`
  ON `campaign_messages` (`selected_sender_id`);

-- ── Template Variations ───────────────────────────────────────────────────────

CREATE TABLE `template_variations` (
  `id`                 VARCHAR(191) NOT NULL,
  `tenant_id`          VARCHAR(191) NOT NULL,
  -- Optional association to a specific campaign or template
  `campaign_id`        VARCHAR(191) NULL,
  `outreach_template_id` VARCHAR(191) NULL,
  -- Channel this variation is for
  `channel`            VARCHAR(50)  NOT NULL COMMENT 'email | whatsapp',
  -- Which slot in the rotation (0-based)
  `variation_index`    INT          NOT NULL DEFAULT 0,
  -- The outreach intent that was used to generate this variation
  `outreach_approach`  TEXT         NULL,
  -- Generated message content
  `subject`            TEXT         NULL     COMMENT 'Email subject (email channel only)',
  `content`            LONGTEXT     NOT NULL,
  -- Lifecycle
  `status`             VARCHAR(50)  NOT NULL DEFAULT 'draft' COMMENT 'draft | approved | rejected',
  -- Provenance
  `ai_provider`        VARCHAR(100) NULL,
  `ai_model`           VARCHAR(100) NULL,
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `template_variations_tenant_id_idx` (`tenant_id`),
  INDEX `template_variations_campaign_id_idx` (`campaign_id`),
  INDEX `template_variations_outreach_template_id_idx` (`outreach_template_id`),
  INDEX `template_variations_tenant_channel_status_idx` (`tenant_id`, `channel`, `status`),

  CONSTRAINT `template_variations_tenant_fk`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── CampaignDispatch analytics ────────────────────────────────────────────────

ALTER TABLE `campaign_dispatches`
  ADD COLUMN `sender_integration_id`    VARCHAR(191) NULL COMMENT 'UserIntegration.id of the sender account used',
  ADD COLUMN `template_variation_id`    VARCHAR(191) NULL COMMENT 'TemplateVariation.id used for this dispatch',
  ADD COLUMN `template_variation_index` INT          NULL COMMENT 'Rotation slot used';
