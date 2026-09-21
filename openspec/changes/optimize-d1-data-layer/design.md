## Context

The existing database schema in [`init.sql`](file:///F:/go_project/cfrelay/init.sql) stores Nostr events in a single `event` table with multiple single-column indexes and a `tags jsonb` column. Client subscriptions filtering on `#e` or `#p` tags generate `tags LIKE '%...%'` queries that trigger SQLite full table scans, consuming millions of rows read daily under Cloudflare D1's free tier. In addition, replaceable events (Kind 0, 3, 10002) accumulate indefinitely without version pruning.

See `proposal.md` for motivation and background.

## Goals / Non-Goals

**Goals:**
- Eliminate full-table scans for tag queries by providing dedicated index table lookups.
- Reduce D1 write overhead by dropping redundant indexes and standardizing on a single composite index `pubkey_kind_time`.
- Normalize query generation to guarantee index utilization even when clients omit `authors` or `kinds`.
- Implement a sliding-window retention policy keeping the latest 5 historical versions of replaceable events.
- Provide zero-touch self-healing schema initialization and migration on Worker startup.

**Non-Goals:**
- Application-layer author whitelist circuit breaker and connection filtering (scoped to a separate application-layer change).
- Content full-text search indexing (NIP-50).
- Altering NIP-95 (KV) or NIP-96 (R2) media file storage.

## Decisions

### 1. Dedicated `event_tag` Relational Table vs. SQLite JSON Virtual Columns
- **Decision**: Create a dedicated `event_tag (event_id, tag_name, tag_value)` table indexed by `(tag_name, tag_value)` and `(event_id)`.
- **Rationale**: Nostr filters almost universally query single-character tags (e.g. `#e` for event IDs, `#p` for pubkeys). A dedicated table allows SQLite B-tree index seeks with exact matches, reducing scanned rows from table-scale to 1-2 rows per tag.
- **Alternatives Considered**: 
  - *SQLite Generated Columns with JSON extract*: Less portable, complex to index arbitrary array structures in SQLite.
  - *In-query `json_each` scanning*: Still evaluates per-row, consuming substantial read operations.

### 2. Radical Index Consolidation to `pubkey_kind_time`
- **Decision**: Drop `pubkeyprefix`, `kindidx`, `timeidx`, and `kindtimeidx`. Retain only `ididx (id)` and create `pubkey_kind_time (pubkey, kind, created_at DESC)`.
- **Rationale**: In Cloudflare D1, every table modification writes to every index on that table. Dropping 4 redundant indexes cuts B-tree write operations by more than half. By normalizing application queries to always include an author and a kinds list, all timeline queries hit this single composite index.
- **Alternatives Considered**: 
  - *Keeping `timeidx` and `kindtimeidx`*: Increases write load and risks SQLite query planner choosing suboptimal single-column indexes.

### 3. Application-Side Query Normalization
- **Decision**: In `queryEventsSql`:
  - If `filter.authors` is absent or empty, inject `[env.OWNER]`.
  - If `filter.kinds` is absent or empty, inject the default standard kinds list `[0, 1, 3, 5, 6, 7, 9735, 10002, 30023]`.
- **Rationale**: Guarantees that every query presents `pubkey` and `kind` conditions to the SQLite query planner, strictly matching `pubkey_kind_time`.

### 4. Sliding Window Version Retention for Replaceable Events
- **Decision**: When inserting replaceable events, prune versions beyond the 5 newest:
  - Standard replaceable (Kind 0, 3, 10000..19999): Grouped by `(pubkey, kind)`.
  - Parameterized replaceable (Kind 30000..39999, NIP-33): Grouped by `(pubkey, kind, d_tag)`.
  - SQL pruning: `DELETE FROM event WHERE id IN (SELECT id FROM event WHERE ... ORDER BY created_at DESC LIMIT -1 OFFSET 5)`.
- **Rationale**: Preserves rollback and recovery capability while preventing unbounded row accumulation.

### 5. Runtime Self-Healing Auto-Migration (`ensureDatabaseSchema`)
- **Decision**: Implement a startup check in `src/index.js` guarded by a module-level variable `let isSchemaReady = false;`.
- **Rationale**: Accommodates one-click "Deploy to Cloudflare" users who do not run CLI migration commands, as well as existing users upgrading without running migrations manually.
- **Execution Flow**:
  1. Check `sqlite_master` for table `event_tag`.
  2. If missing:
     - Create `event` (if missing) and `event_tag`.
     - Migrate legacy tags: `INSERT OR IGNORE INTO event_tag SELECT e.id, json_extract(t.value, '$[0]'), json_extract(t.value, '$[1]') FROM event e, json_each(e.tags) t WHERE ...`.
     - Drop legacy indexes and create `pubkey_kind_time`.
  3. Set `isSchemaReady = true`.

## Risks / Trade-offs

- **[Risk] Migration transaction duration on cold start** → *Mitigation*: For personal/small group relays with thousands of rows, the `INSERT ... SELECT json_each` completes in <200ms, well within Cloudflare Worker startup limits.
- **[Risk] Client queries for unsupported kinds when kinds list is defaulted** → *Mitigation*: The default kinds list covers all core Nostr event types used in practice (profiles, notes, contacts, deletions, reposts, reactions, zaps, relay lists, long-form articles).
- **[Risk] Concurrent cold-start executions** → *Mitigation*: Use `CREATE TABLE IF NOT EXISTS`, `DROP INDEX IF EXISTS`, and `INSERT OR IGNORE` so all initialization statements are idempotent.

## Migration Plan

1. Update `init.sql` for new manual installs.
2. Provide `migrations/0002_optimize_data_layer.sql` for CLI-based migrations.
3. Add `ensureDatabaseSchema` in `src/index.js` to execute automatic schema upgrade upon first request.
