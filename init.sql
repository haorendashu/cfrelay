CREATE TABLE IF NOT EXISTS event (id text NOT NULL, pubkey text NOT NULL, created_at integer NOT NULL, kind integer NOT NULL, tags jsonb NOT NULL, content text NOT NULL, sig text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ididx ON event(id);
CREATE INDEX IF NOT EXISTS pubkey_kind_time ON event(pubkey, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS event_tag (event_id text NOT NULL, tag_name text NOT NULL, tag_value text NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tag_lookup ON event_tag(tag_name, tag_value);
CREATE INDEX IF NOT EXISTS idx_tag_event ON event_tag(event_id);
