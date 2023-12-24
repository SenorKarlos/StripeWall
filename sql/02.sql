ALTER TABLE `stripe_users`
	CHANGE COLUMN `manual` `customer_type` VARCHAR(255) NOT NULL DEFAULT 'new' COLLATE 'utf8mb4_unicode_ci' AFTER `token_expiration`,
	ADD COLUMN `terms_reviewed` VARCHAR(255) NULL DEFAULT 'false' AFTER `customer_type`,
	ADD COLUMN `zones_reviewed` VARCHAR(255) NULL DEFAULT 'false' AFTER `terms_reviewed`,
	CHANGE COLUMN `temp_plan_expiration` `expiration` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci' AFTER `price_id`,
	ADD COLUMN `total_spend` FLOAT NULL DEFAULT NULL AFTER `charges`,
	ADD COLUMN `total_votes` INT(10) NULL DEFAULT NULL AFTER `total_spend`,
	ADD COLUMN `zone_votes` JSON NULL DEFAULT NULL AFTER `total_votes`;

CREATE TABLE `service_zones` (
	`zone_name` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`parent_zone` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`total_votes` INT(10) NOT NULL DEFAULT NULL,
	`calc_workers` INT(10) NOT NULL DEFAULT NULL,
	`admin_worker_override` INT(10) NOT NULL DEFAULT NULL,
	`assigned_workers` INT(10) NOT NULL DEFAULT NULL,
	PRIMARY KEY (`zone_name`) USING BTREE
);