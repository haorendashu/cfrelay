## 1. Database Schema & Migration Scripts

- [x] 1.1 Create `migrations/0002_optimize_data_layer.sql` defining `event_tag` table, index drops, `pubkey_kind_time` creation, and historical tag data migration
- [x] 1.2 Update `init.sql` to reflect the optimized schema (`event_tag`, `pubkey_kind_time`, without legacy redundant indexes)

## 2. Runtime Self-Healing Schema

- [x] 2.1 Implement `ensureDatabaseSchema(env)` in `src/index.js` with table detection, idempotent schema creation, and automatic historical tag migration
- [x] 2.2 Integrate `ensureDatabaseSchema(env)` into `fetch` request handling guarded by an in-memory `isSchemaReady` latch

## 3. Dedicated Tag Storage & Query Optimization

- [x] 3.1 Update `doEvent` in `src/index.js` to insert single-character event tags into `event_tag`
- [x] 3.2 Update event deletion handling in `doEvent` to delete associated rows from `event_tag`
- [x] 3.3 Refactor `queryEventsSql` in `src/index.js` to query tags using indexed subqueries on `event_tag` instead of `tags LIKE` expressions

## 4. Query Normalization & Index Alignment

- [x] 4.1 Update `queryEventsSql` to inject `[env.OWNER]` as default author when `filter.authors` is not specified
- [x] 4.2 Update `queryEventsSql` to inject standard default kinds list when `filter.kinds` is not specified

## 5. Replaceable Event History Retention

- [x] 5.1 Implement pruning for standard replaceable events (Kind 0, 3, 10000..19999) to retain the latest 5 versions per `(pubkey, kind)`
- [x] 5.2 Implement pruning for parameterized replaceable events (Kind 30000..39999) to retain the latest 5 versions per `(pubkey, kind, d_tag)`

## 6. Verification & Validation

- [x] 6.1 Validate SQL migration and schema compatibility
- [x] 6.2 Verify tag subquery and composite index generation in `queryEventsSql`
- [x] 6.3 Test 5-version retention limit on replaceable event insertion
