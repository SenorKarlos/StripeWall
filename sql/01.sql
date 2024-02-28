CREATE TABLE `customers` (
	`user_id` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`user_name` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`email` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`access_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`refresh_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`token_expiration` INT(10) NULL DEFAULT NULL,
	`customer_type` VARCHAR(255) NOT NULL DEFAULT 'inactive' COLLATE 'utf8mb4_unicode_ci',
	`terms_reviewed` VARCHAR(255) NULL DEFAULT 'false' COLLATE 'utf8mb4_unicode_ci',
	`zones_reviewed` VARCHAR(255) NULL DEFAULT 'false' COLLATE 'utf8mb4_unicode_ci',
	`stripe_data` JSON NULL DEFAULT NULL,
	`paygo_data` JSON NULL DEFAULT NULL,
	`donation_data` JSON NULL DEFAULT NULL,
	`tax_rate` FLOAT NULL DEFAULT NULL,
	`charge_list` JSON NULL DEFAULT NULL,
	`total_spend` FLOAT NOT NULL DEFAULT '0',
	`total_votes` INT(10) NOT NULL DEFAULT '1',
	`zone_votes` JSON NULL DEFAULT NULL,
	`format` TINYINT(3) NULL DEFAULT '0',
	`allocations` JSON NULL DEFAULT NULL,
	`qbo_data` JSON NULL DEFAULT NULL,
	PRIMARY KEY (`user_id`) USING BTREE
)
COLLATE='utf8mb4_unicode_ci'
ENGINE=InnoDB
;

CREATE TABLE `metadata` (
	`key` VARCHAR(50) NULL DEFAULT NULL,
	`value` VARCHAR(50) NULL DEFAULT NULL
)
COLLATE='utf8mb4_unicode_ci'
;

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

CREATE TABLE `service_zones` (
	`zone_name` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`parent_zone` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`total_users` INT(10) NOT NULL DEFAULT '0',
	`total_votes` INT(10) NOT NULL DEFAULT '0',
	`calc_workers` INT(10) NOT NULL DEFAULT '0',
	`admin_worker_override` INT(10) NOT NULL DEFAULT '0',
	`assigned_workers` INT(10) NOT NULL DEFAULT '0',
	`img_url` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`zone_roles` JSON NULL DEFAULT NULL,
	PRIMARY KEY (`zone_name`) USING BTREE
)
COLLATE='utf8mb4_unicode_ci'
ENGINE=InnoDB
;
