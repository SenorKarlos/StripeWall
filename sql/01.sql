CREATE TABLE `metadata` (
	`db_version` INT(10) NULL DEFAULT NULL,
	`qbo_auth_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`qbo_refresh_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`qbo_refresh_token_expiry` INT(10) NULL DEFAULT NULL,
	`qbo_access_token` VARCHAR(1023) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`qbo_access_token_expiry` INT(10) NULL DEFAULT NULL
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

CREATE TABLE `stripe_users` (
	`user_id` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`user_name` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
	`email` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`access_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`refresh_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`token_expiration` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`customer_type` VARCHAR(255) NOT NULL DEFAULT 'inactive' COLLATE 'utf8mb4_unicode_ci',
	`terms_reviewed` VARCHAR(255) NULL DEFAULT 'false' COLLATE 'utf8mb4_unicode_ci',
	`zones_reviewed` VARCHAR(255) NULL DEFAULT 'false' COLLATE 'utf8mb4_unicode_ci',
	`stripe_id` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`price_id` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`expiration` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
	`tax_rate` FLOAT NULL DEFAULT NULL,
	`charge_list` JSON NULL DEFAULT NULL,
	`total_spend` FLOAT NOT NULL DEFAULT '0',
	`total_votes` INT(10) NOT NULL DEFAULT '1',
	`zone_votes` JSON NULL DEFAULT NULL,
	`format` TINYINT(3) NULL DEFAULT '0',
	`allocations` JSON NULL DEFAULT NULL,
	PRIMARY KEY (`user_id`) USING BTREE
)
COLLATE='utf8mb4_unicode_ci'
ENGINE=InnoDB
;