CREATE TABLE invitations (code_hash TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL, created_by TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE accounts (user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), invitation_hash TEXT UNIQUE REFERENCES invitations(code_hash), bootstrap_claim INTEGER UNIQUE CHECK(bootstrap_claim=1), created INTEGER NOT NULL, CHECK(invitation_hash IS NOT NULL OR bootstrap_claim=1));
--> statement-breakpoint
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES accounts(user_id), expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sessions_user ON sessions(user_id);
--> statement-breakpoint
CREATE INDEX sessions_expires ON sessions(expires);
--> statement-breakpoint
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires INTEGER NOT NULL);
