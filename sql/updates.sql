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

ALTER TABLE `service_zones` ADD COLUMN `total_users` INT(10) NOT NULL DEFAULT 0 COLLATE 'utf8mb4_unicode_ci' AFTER `parent_zone`;
ALTER TABLE `service_zones` ADD COLUMN `img_url` VARCHAR(255) DEFAULT NULL;

ALTER TABLE `stripe_users` ADD COLUMN `format` TINYINT(4) DEFAULT 0;

ALTER TABLE `service_zones`	ADD COLUMN `zone_roles` JSON NULL DEFAULT NULL AFTER `img_url`;

ALTER TABLE `stripe_users` ADD COLUMN `allocations` JSON DEFAULT NULL;

ALTER TABLE `stripe_users`
	ADD COLUMN `charge_list` JSON NULL DEFAULT NULL AFTER `tax_rate`,
	DROP COLUMN `charges`,
	DROP COLUMN `charge_id`;

CREATE TABLE `metadata` (
	`db_version` INT NULL DEFAULT NULL,
	`qbo_auth_token` VARCHAR(255) NULL DEFAULT NULL,
	`qbo_refresh_token` VARCHAR(255) NULL DEFAULT NULL,
	`qbo_refresh_token_expiry` INT NULL DEFAULT NULL,
	`qbo_access_token` VARCHAR(1023) NULL DEFAULT NULL,
	`qbo_access_token_expiry` INT NULL DEFAULT NULL
)
COLLATE='utf8mb4_unicode_ci'
;
