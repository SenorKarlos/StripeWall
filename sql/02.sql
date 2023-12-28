ALTER TABLE `stripe_users`
	CHANGE COLUMN `manual` `customer_type` VARCHAR(255) NOT NULL DEFAULT 'inactive' COLLATE 'utf8mb4_unicode_ci' AFTER `token_expiration`,
	ADD COLUMN `terms_reviewed` VARCHAR(255) NULL DEFAULT 'false' AFTER `customer_type`,
	ADD COLUMN `zones_reviewed` VARCHAR(255) NULL DEFAULT 'false' AFTER `terms_reviewed`,
	CHANGE COLUMN `temp_plan_expiration` `expiration` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci' AFTER `price_id`,
	CHANGE COLUMN `charges` `charges` INT(10) NOT NULL DEFAULT '0' AFTER `charge_id`;
	ADD COLUMN `total_spend` FLOAT NOT NULL DEFAULT '0' AFTER `charges`,
	ADD COLUMN `total_votes` INT(10) NOT NULL DEFAULT '1' AFTER `total_spend`,
	ADD COLUMN `zone_votes` JSON NULL DEFAULT NULL AFTER `total_votes`;

CREATE TABLE `service_zones` (
	`zone_name` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`parent_zone` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`total_votes` INT(10) NOT NULL DEFAULT '0',
	`calc_workers` INT(10) NOT NULL DEFAULT '0',
	`admin_worker_override` INT(10) NOT NULL DEFAULT '0',
	`assigned_workers` INT(10) NOT NULL DEFAULT '0',
	PRIMARY KEY (`zone_name`) USING BTREE
);