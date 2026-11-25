CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE posts (id TEXT PRIMARY KEY NOT NULL, author TEXT NOT NULL REFERENCES profiles(id), body TEXT NOT NULL, category TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX posts_created ON posts(created DESC);
--> statement-breakpoint
CREATE TABLE likes (post_id TEXT NOT NULL REFERENCES posts(id), user_id TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(post_id,user_id));
--> statement-breakpoint
CREATE TABLE comments (id TEXT PRIMARY KEY NOT NULL, post_id TEXT NOT NULL REFERENCES posts(id), author TEXT NOT NULL REFERENCES profiles(id), body TEXT NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX comments_post ON comments(post_id,created);
