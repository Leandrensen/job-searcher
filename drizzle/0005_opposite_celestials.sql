CREATE TABLE `job_embeddings` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`text_hash` text NOT NULL,
	`vector` blob NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
