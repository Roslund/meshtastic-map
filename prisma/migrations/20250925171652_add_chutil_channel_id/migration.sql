-- AlterTable
ALTER TABLE `channel_utilization_stats` ADD COLUMN `channel_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `channel_utilization_stats_channel_id_idx` ON `channel_utilization_stats`(`channel_id`);
