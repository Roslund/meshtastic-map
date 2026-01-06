-- CreateTable
CREATE TABLE `edges` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `from_node_id` BIGINT NOT NULL,
    `to_node_id` BIGINT NOT NULL,
    `snr` INTEGER NOT NULL,
    `from_latitude` INTEGER NULL,
    `from_longitude` INTEGER NULL,
    `to_latitude` INTEGER NULL,
    `to_longitude` INTEGER NULL,
    `packet_id` BIGINT NOT NULL,
    `channel_id` VARCHAR(191) NULL,
    `gateway_id` BIGINT NULL,
    `source` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `edges_from_node_id_idx`(`from_node_id`),
    INDEX `edges_to_node_id_idx`(`to_node_id`),
    INDEX `edges_created_at_idx`(`created_at`),
    INDEX `edges_from_node_id_to_node_id_idx`(`from_node_id`, `to_node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
