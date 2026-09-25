-- Phase 7: durable MySQL worker leases, heartbeats, and message retry state.

ALTER TABLE `jobs`
  ADD COLUMN `worker_id` VARCHAR(191) NULL,
  ADD COLUMN `lease_token` VARCHAR(191) NULL,
  ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
  ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
  ADD COLUMN `attempt` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `jobs_status_lease_expires_at_created_at_idx`
  ON `jobs`(`status`, `lease_expires_at`, `created_at`);

ALTER TABLE `campaign_messages`
  ADD COLUMN `attempt_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
  ADD COLUMN `last_attempt_at` DATETIME(3) NULL,
  ADD COLUMN `lease_owner` VARCHAR(191) NULL,
  ADD COLUMN `lease_token` VARCHAR(191) NULL,
  ADD COLUMN `lease_expires_at` DATETIME(3) NULL;

CREATE INDEX `camp_msg_worker_claim_idx`
  ON `campaign_messages`(`campaign_id`, `status`, `next_attempt_at`, `lease_expires_at`, `created_at`);
