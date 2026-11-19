CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ats` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`home_country` text,
	`origin` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_fetched_at` text,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_ats_slug_uq` ON `companies` (`ats`,`slug`);--> statement-breakpoint
CREATE TABLE `company_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized_name` text NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`careers_url` text,
	`ats_hints` text DEFAULT '[]' NOT NULL,
	`home_country` text,
	`origin` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_checked_at` text,
	`next_check_at` text,
	`company_id` integer,
	`ambiguous_matches` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_candidates_normalized_name_unique` ON `company_candidates` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `company_candidates_status_next_check_idx` ON `company_candidates` (`status`,`next_check_at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `jobs` ADD `closed_at` text;--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_closed_at_idx` ON `jobs` (`closed_at`);