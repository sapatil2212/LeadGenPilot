-- CreateTable
CREATE TABLE `business_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `business_name` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `business_type` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `country` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `contact_email` VARCHAR(191) NULL,
    `contact_phone` VARCHAR(191) NULL,
    `locations_served` TEXT NULL,
    `target_customer_types` TEXT NULL,
    `target_industries` TEXT NULL,
    `unique_selling_points` TEXT NULL,
    `certifications` TEXT NULL,
    `decision_maker_roles` TEXT NULL,
    `brand_voice` TEXT NULL,
    `sales_objectives` TEXT NULL,
    `ai_confidence` DOUBLE NULL,
    `missing_information` TEXT NULL,
    `last_extracted_at` DATETIME(3) NULL,
    `last_prompt_name` VARCHAR(191) NULL,
    `last_prompt_version` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `business_profiles_tenant_id_key`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_products` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `key_features` TEXT NULL,
    `ideal_for` TEXT NULL,
    `price_range` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `business_products_tenant_id_idx`(`tenant_id`),
    INDEX `business_products_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_services` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `ideal_for` TEXT NULL,
    `price_range` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `business_services_tenant_id_idx`(`tenant_id`),
    INDEX `business_services_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_documents` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `original_name` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `file_type` VARCHAR(191) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `storage_path` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `error` TEXT NULL,
    `extracted_text` LONGTEXT NULL,
    `char_count` INTEGER NULL,
    `chunk_count` INTEGER NULL,
    `category` VARCHAR(191) NULL,
    `uploaded_by_id` VARCHAR(191) NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_documents_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `knowledge_documents_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `knowledge_documents_uploaded_by_id_idx`(`uploaded_by_id`),
    INDEX `knowledge_documents_tenant_id_checksum_idx`(`tenant_id`, `checksum`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_chunks` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `document_id` VARCHAR(191) NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `token_count` INTEGER NULL,
    `embedding` TEXT NULL,
    `embedding_model` VARCHAR(191) NULL,
    `embedding_dims` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `knowledge_chunks_tenant_id_idx`(`tenant_id`),
    INDEX `knowledge_chunks_document_id_chunk_index_idx`(`document_id`, `chunk_index`),
    INDEX `knowledge_chunks_tenant_id_embedding_model_idx`(`tenant_id`, `embedding_model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_items` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 1,
    `source` VARCHAR(191) NOT NULL DEFAULT 'user',
    `source_document_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_items_tenant_id_category_idx`(`tenant_id`, `category`),
    INDEX `knowledge_items_source_document_id_idx`(`source_document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `title` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'assistant',
    `message_count` INTEGER NOT NULL DEFAULT 0,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_conversations_tenant_id_updated_at_idx`(`tenant_id`, `updated_at`),
    INDEX `ai_conversations_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `provider` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `prompt_name` VARCHAR(191) NULL,
    `prompt_version` INTEGER NULL,
    `total_tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `cited_chunk_ids` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `ai_messages_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `business_profiles` ADD CONSTRAINT `business_profiles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_products` ADD CONSTRAINT `business_products_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_services` ADD CONSTRAINT `business_services_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_chunks` ADD CONSTRAINT `knowledge_chunks_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_chunks` ADD CONSTRAINT `knowledge_chunks_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_items` ADD CONSTRAINT `knowledge_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_items` ADD CONSTRAINT `knowledge_items_source_document_id_fkey` FOREIGN KEY (`source_document_id`) REFERENCES `knowledge_documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

