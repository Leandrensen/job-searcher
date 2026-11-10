CREATE TABLE `fetch_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`status` text NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`invalid` integer DEFAULT 0 NOT NULL,
	`filtered` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `fetch_runs_source_started_idx` ON `fetch_runs` (`source`,`started_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`remote` integer,
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
	FOREIGN KEY (`duplicate_of`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_id_uq` ON `jobs` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_key_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_posted_at_idx` ON `jobs` (`posted_at`);