ALTER TABLE `customers`
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

ALTER TABLE `customers` ADD COLUMN `format` TINYINT(4) DEFAULT 0;

ALTER TABLE `service_zones`	ADD COLUMN `zone_roles` JSON NULL DEFAULT NULL AFTER `img_url`;

ALTER TABLE `customers` ADD COLUMN `allocations` JSON DEFAULT NULL;

ALTER TABLE `customers`
	ADD COLUMN `charge_list` JSON NULL DEFAULT NULL AFTER `tax_rate`,
	DROP COLUMN `charges`,
	DROP COLUMN `charge_id`;

CREATE TABLE `qbo_metadata` (
	`id` INT(10) NOT NULL DEFAULT '1',
	`basic_auth_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`refresh_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`refresh_token_expiry` INT(10) NULL DEFAULT NULL,
	`last_refresh_message` INT(10) NULL DEFAULT NULL,
	`oauth_token` VARCHAR(1023) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`oauth_token_expiry` INT(10) NULL DEFAULT NULL,
	`service_product_id` INT(10) NULL DEFAULT NULL,
	`donation_product_id` INT(10) NULL DEFAULT NULL,
	`stripe_fee_expense_id` INT(10) NULL DEFAULT NULL,
	`stripe_account_id` INT(10) NULL DEFAULT NULL,
	`bank_account_id` INT(10) NULL DEFAULT NULL,
	`next_invoice` VARCHAR(47) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	PRIMARY KEY (`id`) USING BTREE
)
COLLATE='utf8mb4_unicode_ci'
ENGINE=InnoDB
;

ALTER TABLE `customers`
	ADD COLUMN `qbo_data` JSON NULL DEFAULT NULL AFTER `allocations`;
	ADD COLUMN `stripe_data` JSON NULL DEFAULT NULL AFTER `zones_reviewed`;
	DROP COLUMN `stripe_id`,
	DROP COLUMN `price_id`;
	CHANGE COLUMN `token_expiration` `token_expiration` INT(10) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci' AFTER `refresh_token`;
  ADD COLUMN `manual_data` JSON NULL AFTER `stripe_data`,
	DROP COLUMN `expiration`;