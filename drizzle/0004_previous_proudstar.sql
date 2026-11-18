PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`workplace_type` text,
	`departments` text DEFAULT '[]' NOT NULL,
	`regions` text DEFAULT '[]' NOT NULL,
	`employment_type` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`salary_min` real,
	`salary_max` real,
	`salary_currency` text,
	`salary_period` text,
	`description_html` text NOT NULL,
	`description_text` text NOT NULL,
	`posted_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`duplicate_of` integer,
	`company_id` integer,
	`closed_at` text,
	FOREIGN KEY (`duplicate_of`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "source", "external_id", "url", "apply_url", "title", "company", "location", "workplace_type", "departments", "regions", "employment_type", "tags", "salary_min", "salary_max", "salary_currency", "salary_period", "description_html", "description_text", "posted_at", "first_seen_at", "last_seen_at", "dedupe_key", "duplicate_of", "company_id", "closed_at") SELECT "id", "source", "external_id", "url", "apply_url", "title", "company", "location", "workplace_type", "departments", "regions", "employment_type", "tags", "salary_min", "salary_max", "salary_currency", "salary_period", "description_html", "description_text", "posted_at", "first_seen_at", "last_seen_at", "dedupe_key", "duplicate_of", "company_id", "closed_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_id_uq` ON `jobs` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_key_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_posted_at_idx` ON `jobs` (`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_closed_at_idx` ON `jobs` (`closed_at`);