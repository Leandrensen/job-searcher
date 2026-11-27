ALTER TABLE `jobs` ADD `group_id` integer;--> statement-breakpoint
CREATE INDEX `jobs_group_id_idx` ON `jobs` (`group_id`);