-- A normalized phone number identifies at most one account. MySQL permits
-- multiple NULL values in a unique index, so users may still omit phone.
CREATE UNIQUE INDEX `users_phone_key` ON `users`(`phone`);
