-- Migration: add_campaign_shuffle_and_time_pause
--
-- Adds two anti-block controls to the Campaign model:
--   1. shuffle_content — when true, each outgoing message's wording is lightly
--      reworded by AI at send time (same meaning/offer/variables) so a bulk run
--      is not byte-identical.
--   2. pause_every_minutes — pause after this many minutes of continuous sending
--      (time-based batch pause). 0 keeps the existing count-based behaviour.
--
-- Both have defaults, so existing campaigns are unaffected.

ALTER TABLE `campaigns`
  ADD COLUMN `shuffle_content`     BOOLEAN NOT NULL DEFAULT false COMMENT 'AI reword each message at send time for anti-block',
  ADD COLUMN `pause_every_minutes` INT     NOT NULL DEFAULT 0     COMMENT 'Time-based batch pause trigger in minutes (0 = use count-based batchSize)';
