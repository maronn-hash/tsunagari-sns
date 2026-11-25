CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES accounts(user_id), session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX push_subscription_user ON push_subscriptions(user_id);
--> statement-breakpoint
CREATE TABLE push_jobs (id TEXT PRIMARY KEY NOT NULL, endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE, created INTEGER NOT NULL, available INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
