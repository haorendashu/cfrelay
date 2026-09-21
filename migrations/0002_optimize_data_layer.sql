-- 1. Create event_tag table and indexes
CREATE TABLE IF NOT EXISTS event_tag (
    event_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    tag_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tag_lookup ON event_tag(tag_name, tag_value);
CREATE INDEX IF NOT EXISTS idx_tag_event ON event_tag(event_id);

-- 2. Migrate existing historical single-character tags
INSERT OR IGNORE INTO event_tag (event_id, tag_name, tag_value)
SELECT 
    e.id,
    json_extract(t.value, '$[0]') AS tag_name,
    json_extract(t.value, '$[1]') AS tag_value
FROM event e, json_each(e.tags) t
WHERE json_valid(e.tags) = 1
  AND json_extract(t.value, '$[0]') IS NOT NULL
  AND json_extract(t.value, '$[1]') IS NOT NULL
  AND length(json_extract(t.value, '$[0]')) = 1;

-- 3. Drop legacy redundant indexes
DROP INDEX IF EXISTS pubkeyprefix;
DROP INDEX IF EXISTS kindidx;
DROP INDEX IF EXISTS timeidx;
DROP INDEX IF EXISTS kindtimeidx;

-- 4. Create single core composite index
CREATE INDEX IF NOT EXISTS pubkey_kind_time ON event(pubkey, kind, created_at DESC);
