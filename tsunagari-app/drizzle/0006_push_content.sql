ALTER TABLE push_subscriptions ADD COLUMN p256dh TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE push_subscriptions ADD COLUMN auth TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE push_jobs ADD COLUMN payload TEXT NOT NULL DEFAULT '';
