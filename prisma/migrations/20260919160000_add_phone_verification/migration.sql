-- Add optional phone verification metadata to users.
ALTER TABLE `users`
  ADD COLUMN `phone` VARCHAR(191) NULL,
  ADD COLUMN `phone_verified` BOOLEAN NOT NULL DEFAULT false;

-- Allow one OTP table to hold either an email or phone destination.
ALTER TABLE `email_otps`
  MODIFY `email` VARCHAR(191) NULL,
  ADD COLUMN `phone` VARCHAR(191) NULL;

CREATE INDEX `email_otps_phone_idx` ON `email_otps`(`phone`);
