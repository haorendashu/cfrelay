# event-storage Specification

## Purpose
Provides resilient, high-performance data storage and indexing in Cloudflare D1 for Nostr events, eliminating full-table scans, managing index lifecycles, and enforcing historical version retention policies.

## Requirements

### Requirement: Self-Healing Database Initialization
The storage layer SHALL automatically verify and initialize database schema, tables, and indexes upon cold start if they do not exist, ensuring zero-touch first-time deployments and seamless legacy upgrades.

#### Scenario: Fresh deployment initialization
- **WHEN** the Worker receives its initial request and neither `event` nor `event_tag` table exists
- **THEN** the system SHALL create `event`, `event_tag`, and the required indexes in a single initialization transaction before handling the request

#### Scenario: Existing deployment tag migration
- **WHEN** the Worker receives a request where `event` exists but `event_tag` does not
- **THEN** the system SHALL create `event_tag`, extract existing single-letter tags from `event.tags` into `event_tag`, drop legacy redundant indexes, and create the `pubkey_kind_time` index

#### Scenario: Subsequent requests after initialization
- **WHEN** a request arrives and the database schema has already been verified in the Worker instance lifecycle
- **THEN** the system SHALL proceed immediately to request processing without executing schema verification queries

### Requirement: Dedicated Tag Indexing and Querying
The system SHALL store single-character Nostr event tags in a dedicated `event_tag` table and use indexed subqueries for tag-based queries instead of `tags LIKE` expressions.

#### Scenario: Storing tags upon event creation
- **WHEN** a valid event with tags is written to the database
- **THEN** all single-character tags with valid name-value pairs SHALL be inserted into `event_tag` associated with the event ID

#### Scenario: Querying events by tag
- **WHEN** a client submits a filter querying tags (e.g. `#e` or `#p`)
- **THEN** the database query SHALL match event IDs using indexed lookups against `event_tag(tag_name, tag_value)` without performing full-table LIKE scans

#### Scenario: Cleaning tags upon event deletion
- **WHEN** an event is deleted due to a deletion request (NIP-09) or version pruning
- **THEN** all entries in `event_tag` associated with the deleted event ID SHALL be removed

### Requirement: Single Composite Index Coverage
The event storage SHALL maintain only `ididx` on `event(id)` and `pubkey_kind_time` on `event(pubkey, kind, created_at DESC)`, with the query builder normalizing missing criteria to ensure index matching.

#### Scenario: Query omitting authors
- **WHEN** a query filter does not specify `authors`
- **THEN** the query layer SHALL inject the relay owner's pubkey as the default author filter

#### Scenario: Query omitting kinds
- **WHEN** a query filter does not specify `kinds`
- **THEN** the query layer SHALL inject the standard supported kinds list to ensure the query matches the composite index

### Requirement: Replaceable Event History Retention
The storage system SHALL retain the latest 5 versions of replaceable events per unique identity and prune older records to prevent unbounded database growth while preserving rollback recovery.

#### Scenario: Pruning standard replaceable events
- **WHEN** a standard replaceable event (kind 0, 3, or 10000..19999) is inserted
- **THEN** the system SHALL retain the 5 newest versions for that `(pubkey, kind)` ordered by `created_at DESC` and delete all older versions from `event` and `event_tag`

#### Scenario: Pruning parameterized replaceable events
- **WHEN** a parameterized replaceable event (kind 30000..39999) is inserted
- **THEN** the system SHALL retain the 5 newest versions for that `(pubkey, kind, d_tag)` ordered by `created_at DESC` and delete all older versions from `event` and `event_tag`
