-- Phase 7: a worker may recover a leased message; retain exactly one final report per message.
-- MySQL permits multiple NULL values in this unique index, so manual dispatch rows remain append-only.
CREATE UNIQUE INDEX `campaign_dispatches_campaign_message_id_key`
  ON `campaign_dispatches`(`campaign_message_id`);