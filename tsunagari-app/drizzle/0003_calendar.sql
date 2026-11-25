CREATE TABLE IF NOT EXISTS calendar_events (
 id TEXT PRIMARY KEY NOT NULL,
 author TEXT NOT NULL REFERENCES profiles(id),
 title TEXT NOT NULL,
 event_date TEXT NOT NULL,
 start_time TEXT NOT NULL DEFAULT '',
 end_time TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_events_date ON calendar_events(event_date,start_time,created);

