ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1));
--> statement-breakpoint
ALTER TABLE comments ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1));
--> statement-breakpoint
CREATE TABLE content_reports (id TEXT PRIMARY KEY NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')), target_id TEXT NOT NULL, post_id TEXT NOT NULL, reporter TEXT NOT NULL REFERENCES profiles(id), category TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), resolution TEXT NOT NULL DEFAULT '', resolved_by TEXT, created INTEGER NOT NULL, resolved INTEGER, UNIQUE(reporter,target_type,target_id));
--> statement-breakpoint
CREATE INDEX reports_status_created ON content_reports(status,created DESC);
--> statement-breakpoint
CREATE TABLE moderation_audit (id TEXT PRIMARY KEY NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_audit_created ON moderation_audit(created DESC,id);
--> statement-breakpoint
CREATE TABLE moderation_settings (id INTEGER PRIMARY KEY CHECK(id=1), retention_days INTEGER NOT NULL DEFAULT 0 CHECK(retention_days IN (0,30,90,180,365,730)), updated INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
INSERT INTO moderation_settings(id) VALUES (1);
--> statement-breakpoint
CREATE TABLE media_deletions (key TEXT PRIMARY KEY NOT NULL, created INTEGER NOT NULL);
