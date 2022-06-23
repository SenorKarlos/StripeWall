CREATE TABLE stripe_users (
 `user_id` varchar(255) NOT NULL,
 `user_name` varchar(255) NOT NULL,
 `last_login` varchar(255) DEFAULT NULL,
 `stripe_id` varchar(255) DEFAULT NULL,
 `plan_id` varchar(255) DEFAULT NULL,
 `email` varchar(255) DEFAULT NULL,
 `temp_plan_expiration` varchar(255) DEFAULT NULL,
 `access_token` varchar(255) DEFAULT NULL,
 `refresh_token` varchar(255) DEFAULT 'NULL',
 `token_expiration` varchar(255) DEFAULT NULL,
 `last_updated` varchar(255) DEFAULT 'NULL',
 PRIMARY KEY (`user_id`)
);