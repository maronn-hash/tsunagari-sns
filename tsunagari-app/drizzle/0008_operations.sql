CREATE TABLE operation_audit (id TEXT PRIMARY KEY NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, status INTEGER NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX operation_audit_created ON operation_audit(created DESC,id);
--> statement-breakpoint
CREATE TABLE system_events (id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX system_events_created ON system_events(created DESC,id);
--> statement-breakpoint
CREATE TABLE backup_settings (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), keep_count INTEGER NOT NULL DEFAULT 7 CHECK(keep_count IN (7,14,30)));
--> statement-breakpoint
INSERT INTO backup_settings(id) VALUES(1);
--> statement-breakpoint
CREATE TABLE backup_runs (id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, finished INTEGER);
