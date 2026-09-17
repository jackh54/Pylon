CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '["read"]' NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`org_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channels_org_idx` ON `channels` (`org_id`);--> statement-breakpoint
CREATE TABLE `daily_stats` (
	`monitor_id` text NOT NULL,
	`day` text NOT NULL,
	`checks` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`degraded` integer DEFAULT 0 NOT NULL,
	`latency_sum` integer DEFAULT 0 NOT NULL,
	`latency_max` integer DEFAULT 0 NOT NULL,
	`players_peak` integer DEFAULT 0 NOT NULL,
	`players_sum` integer DEFAULT 0 NOT NULL,
	`downtime_sec` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`monitor_id`, `day`),
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_monitor_idx` ON `events` (`monitor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incident_components` (
	`incident_id` text NOT NULL,
	`component_id` text NOT NULL,
	PRIMARY KEY(`incident_id`, `component_id`),
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_id`) REFERENCES `page_components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `incident_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incident_updates_incident_idx` ON `incident_updates` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`page_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'investigating' NOT NULL,
	`impact` text DEFAULT 'minor' NOT NULL,
	`auto` integer DEFAULT false NOT NULL,
	`monitor_id` text,
	`started_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`resolved_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `status_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incidents_page_idx` ON `incidents` (`page_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `incidents_org_idx` ON `incidents` (`org_id`);--> statement-breakpoint
CREATE TABLE `maintenances` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`component_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `status_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenances_page_idx` ON `maintenances` (`page_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `monitor_channels` (
	`monitor_id` text NOT NULL,
	`channel_id` text NOT NULL,
	PRIMARY KEY(`monitor_id`, `channel_id`),
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`interval_sec` integer DEFAULT 60 NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`retries` integer DEFAULT 2 NOT NULL,
	`degraded_latency_ms` integer,
	`runner` text DEFAULT 'edge' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_checked_at` integer,
	`last_changed_at` integer,
	`last_latency_ms` integer,
	`last_message` text,
	`last_data` text,
	`push_token` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `monitors_org_idx` ON `monitors` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_push_token_idx` ON `monitors` (`push_token`);--> statement-breakpoint
CREATE TABLE `org_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_invites_token_idx` ON `org_invites` (`token`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `page_components` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`section_id` text,
	`monitor_id` text,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`display` text DEFAULT '{"showLatency":true,"showPlayers":true,"showHistory":true}' NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `status_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `page_sections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_components_page_idx` ON `page_components` (`page_id`);--> statement-breakpoint
CREATE INDEX `page_components_monitor_idx` ON `page_components` (`monitor_id`);--> statement-breakpoint
CREATE TABLE `page_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `status_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_sections_page_idx` ON `page_sections` (`page_id`);--> statement-breakpoint
CREATE TABLE `relays` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`region` text DEFAULT 'default' NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen_at` integer,
	`version` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relays_token_idx` ON `relays` (`token_hash`);--> statement-breakpoint
CREATE INDEX `relays_org_idx` ON `relays` (`org_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `status_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`custom_domain` text,
	`logo_url` text,
	`favicon_url` text,
	`theme` text DEFAULT '{"mode":"system","accent":"#22c55e","radius":"rounded","historyStyle":"bars"}' NOT NULL,
	`links` text DEFAULT '{}' NOT NULL,
	`hero` text DEFAULT '{}' NOT NULL,
	`seo` text DEFAULT '{}' NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`password_hash` text,
	`history_days` integer DEFAULT 90 NOT NULL,
	`allow_subscribers` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `status_pages_slug_idx` ON `status_pages` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `status_pages_domain_idx` ON `status_pages` (`custom_domain`);--> statement-breakpoint
CREATE INDEX `status_pages_org_idx` ON `status_pages` (`org_id`);--> statement-breakpoint
CREATE TABLE `subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `status_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_token_idx` ON `subscribers` (`token`);--> statement-breakpoint
CREATE INDEX `subscribers_page_idx` ON `subscribers` (`page_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text,
	`avatar_url` text,
	`discord_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_idx` ON `users` (`discord_id`);