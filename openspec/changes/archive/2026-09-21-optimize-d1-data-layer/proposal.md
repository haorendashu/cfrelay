## Why

The Nostr relay running on Cloudflare Workers frequently exceeds Cloudflare D1's daily free-tier limit of 5,000,000 rows read. Because D1 bills and limits based on SQLite scanned rows rather than returned rows, tag queries using `tags LIKE '%...%'` and missing composite indexes cause full table scans on every client subscription and crawler probe. Furthermore, replaceable events (Kind 0, 3, 10002) accumulate indefinitely, and redundant single-column indexes waste write operations.

This change optimizes the data layer to eliminate full table scans, streamline indexes, safely retain the latest 5 historical versions of replaceable events for rollback recovery, and ensure zero-touch self-healing database initialization for both new and existing deployments.

## What Changes

- **Self-Healing Schema & Seamless Auto-Migration**: On Worker cold start, automatically detect and create missing tables (`event`, `event_tag`) and indexes, safely migrating existing event tags to `event_tag` in a single transaction without manual CLI intervention.
- **Dedicated Tag Index Table (`event_tag`)**: Introduce an `event_tag` table indexed by `(tag_name, tag_value)` and `(event_id)`. Replace full-table `tags LIKE '%...%'` queries with indexed subqueries on `event_tag`.
- **Index Lifecycle Optimization**: Drop redundant legacy indexes (`pubkeyprefix`, `kindidx`, `timeidx`, `kindtimeidx`) to conserve D1 write limits and reduce storage. Introduce a single high-efficiency composite index `pubkey_kind_time ON event(pubkey, kind, created_at DESC)`.
- **Query Normalization with Safe Defaults**: When queries omit `authors`, automatically default to `[env.OWNER]`. When queries omit `kinds`, automatically default to standard event kinds, guaranteeing 100% composite index coverage.
- **Replaceable Events Retention (Latest 5 Versions)**:
  - For standard replaceable events (`kind` 0, 3, 10000..19999), retain the latest 5 versions per `(pubkey, kind)` and prune older records.
  - For parameterized replaceable events (NIP-33, `kind` 30000..39999), retain the latest 5 versions per `(pubkey, kind, d_tag)` and prune older records.
- **Migration & Init Scripts**: Add `migrations/0002_optimize_data_layer.sql` and update `init.sql` to reflect the clean target schema.

## Capabilities

### New Capabilities
- `event-storage`: Database schema, indexing, lifecycle management, and tag query indexing for Nostr events in Cloudflare D1.

### Modified Capabilities
*(None - first formal capability specification in this repository)*

## Impact

- **Database**: Adds `event_tag` table, drops 4 legacy indexes, creates `pubkey_kind_time` index.
- **Application Code**: Updates `src/index.js` to implement schema self-healing (`ensureDatabaseSchema`), tag insertion/deletion, parameterized and standard replaceable event retention logic, and tag subqueries in `queryEventsSql`.
- **Deployment**: Both new one-click deployments and existing user upgrades initialize or migrate automatically on first request.
