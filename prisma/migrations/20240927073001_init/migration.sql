-- CreateTable
CREATE TABLE `user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `location` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(50) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `password` VARCHAR(20) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `access_level` ENUM('client', 'client_admin', 'technician', 'eg_admin', 'eg_super_admin', 'others') NOT NULL DEFAULT 'client',
    `pan_id` VARCHAR(20) NULL,
    `aadhaar_id` VARCHAR(20) NULL,
    `permanent_address` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `UK__user_phone`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NULL,
    `branch_name` VARCHAR(50) NULL,
    `email` VARCHAR(100) NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `location` VARCHAR(191) NULL,
    `logo` VARCHAR(300) NULL,
    `parent_company_link` INTEGER NULL,
    `address_link` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `company_name_branch_name_key`(`name`, `branch_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_user` (
    `user_link` INTEGER NOT NULL,
    `company_link` INTEGER NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `role` VARCHAR(50) NULL,

    PRIMARY KEY (`user_link`, `company_link`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `address` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lat` DECIMAL(10, 5) NULL,
    `long` DECIMAL(10, 5) NULL,
    `boundary` JSON NULL,
    `zoom_level` DECIMAL(10, 5) NULL,
    `address_line` VARCHAR(255) NULL,
    `locality` VARCHAR(255) NULL,
    `district` VARCHAR(50) NULL,
    `city` VARCHAR(50) NULL,
    `state` VARCHAR(30) NULL,
    `country` VARCHAR(30) NULL,
    `pincode` VARCHAR(10) NULL,
    `ero_code` VARCHAR(30) NULL,
    `area_code` VARCHAR(30) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `address_lat_long_address_line_pincode_key`(`lat`, `long`, `address_line`, `pincode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `equipment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `make` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `eg_serial_number` VARCHAR(191) NOT NULL,
    `serial_number` VARCHAR(191) NULL,
    `specifications` VARCHAR(191) NULL,
    `image_url` VARCHAR(191) NULL,
    `manufacturerDate` DATETIME(3) NULL,
    `location` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `tmFrequency` ENUM('daily', 'weekly', 'biweekly', 'monthly', 'bi_monthly', 'tri_monthly', 'quarterly', 'semi_annual', 'annual') NULL,
    `company_link` INTEGER NULL,
    `manual` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `equipment_eg_serial_number_key`(`eg_serial_number`),
    UNIQUE INDEX `equipment_eg_serial_number_make_model_key`(`eg_serial_number`, `make`, `model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `call_type` ENUM('amc_preventive_maintenance', 'breakdown', 'service') NULL,
    `equipment_link` INTEGER NULL,
    `ticket_no` VARCHAR(191) NOT NULL,
    `otp` VARCHAR(191) NOT NULL,
    `feedback` VARCHAR(191) NULL,
    `action_taken` VARCHAR(191) NULL,
    `req_details` VARCHAR(191) NULL,
    `follow_up` BOOLEAN NULL,
    `action_req_details` VARCHAR(191) NULL,
    `service_satisfactory` BOOLEAN NULL,
    `is_running_smoothly` BOOLEAN NULL,
    `notes` VARCHAR(191) NULL,
    `rating` INTEGER NULL,
    `status` ENUM('open', 'hold', 'in_progress', 'closed') NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `UK__ticket_no`(`ticket_no`),
    UNIQUE INDEX `tasks_equipment_link_name_description_call_type_key`(`equipment_link`, `name`, `description`, `call_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(191) NOT NULL,
    `taskId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `out_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(191) NOT NULL,
    `taskId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hold_reason` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hold` ENUM('spare_required', 'expert_service_required', 'others') NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `spare_part_number` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,
    `task_link` INTEGER NOT NULL,

    UNIQUE INDEX `hold_reason_hold_spare_part_number_task_link_key`(`hold`, `spare_part_number`, `task_link`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `technician_link` INTEGER NULL,
    `client_link` INTEGER NOT NULL,
    `task_link` INTEGER NOT NULL,
    `status` ENUM('open', 'hold', 'in_progress', 'closed') NOT NULL DEFAULT 'open',
    `reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `task_user_technician_link_client_link_task_link_status_key`(`technician_link`, `client_link`, `task_link`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fcm_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `user_link` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `tokens_device_id_fcm_id_user_link_key`(`device_id`, `fcm_id`, `user_link`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `image_url` VARCHAR(191) NULL,
    `task_link` INTEGER NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `user_link` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `company` ADD CONSTRAINT `FK__parent_company` FOREIGN KEY (`parent_company_link`) REFERENCES `company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company` ADD CONSTRAINT `company_address_link_fkey` FOREIGN KEY (`address_link`) REFERENCES `address`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_user` ADD CONSTRAINT `company_user_user_link_fkey` FOREIGN KEY (`user_link`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_user` ADD CONSTRAINT `company_user_company_link_fkey` FOREIGN KEY (`company_link`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_company_link_fkey` FOREIGN KEY (`company_link`) REFERENCES `company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_equipment_link_fkey` FOREIGN KEY (`equipment_link`) REFERENCES `equipment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `images` ADD CONSTRAINT `images_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `out_images` ADD CONSTRAINT `out_images_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hold_reason` ADD CONSTRAINT `hold_reason_task_link_fkey` FOREIGN KEY (`task_link`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_user` ADD CONSTRAINT `task_user_task_link_fkey` FOREIGN KEY (`task_link`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tokens` ADD CONSTRAINT `tokens_user_link_fkey` FOREIGN KEY (`user_link`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_link_fkey` FOREIGN KEY (`user_link`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
