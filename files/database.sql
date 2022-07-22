CREATE TABLE stripe_users (
  `user_id` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
  `user_name` VARCHAR(255) NOT NULL COLLATE 'utf8mb4_unicode_ci',
  `email` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `access_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `refresh_token` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `token_expiration` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `manual` VARCHAR(255) NOT NULL DEFAULT 'false' COLLATE 'utf8mb4_unicode_ci',
  `stripe_id` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `price_id` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `temp_plan_expiration` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `fee_amount` SMALLINT(5) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `tax_amount` SMALLINT(5) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  `charge_id` VARCHAR(255) NULL DEFAULT NULL COLLATE 'utf8mb4_unicode_ci',
  PRIMARY KEY (`user_id`)
);