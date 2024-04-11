CREATE TABLE IF NOT EXISTS event (id text NOT NULL, pubkey text NOT NULL, created_at integer NOT NULL, kind integer NOT NULL, tags jsonb NOT NULL, content text NOT NULL, sig text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ididx ON event(id);
CREATE INDEX IF NOT EXISTS pubkeyprefix ON event(pubkey);
CREATE INDEX IF NOT EXISTS timeidx ON event(created_at DESC);
CREATE INDEX IF NOT EXISTS kindidx ON event(kind);
CREATE INDEX IF NOT EXISTS kindtimeidx ON event(kind,created_at DESC);
