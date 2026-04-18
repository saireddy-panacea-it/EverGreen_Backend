/*
  Warnings:

  - You are about to drop the `out_images` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `out_images` DROP FOREIGN KEY `out_images_taskId_fkey`;

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `out_images` TEXT NULL;

-- DropTable
DROP TABLE `out_images`;
