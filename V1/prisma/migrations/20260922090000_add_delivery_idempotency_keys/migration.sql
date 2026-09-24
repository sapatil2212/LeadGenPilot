-- AlterTable
ALTER TABLE `campaign_messages` ADD COLUMN `idempotency_key` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `campaign_dispatches` ADD COLUMN `idempotency_key` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `camp_msg_idempotency_idx` ON `campaign_messages`(`tenant_id`, `idempotency_key`);

-- CreateIndex
CREATE INDEX `campaign_dispatches_idempotency_idx` ON `campaign_dispatches`(`tenant_id`, `idempotency_key`);
