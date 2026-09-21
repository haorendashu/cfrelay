# Request Guard Specification

## Purpose

Protects the relay from unauthorized, irrelevant, or abusive traffic by intercepting invalid author queries, pre-filtering private events, rate limiting unauthenticated sessions, and enabling HTTP edge caching.

## Requirements

### Requirement: Whitelist Circuit Breaker
The system SHALL verify query author filters against the authorized relay whitelist prior to database execution, short-circuiting queries for non-whitelisted authors directly in memory.

#### Scenario: Query targeting non-whitelisted authors
- **WHEN** a client submits a `REQ` filter specifying authors where none belong to the authorized whitelist and no event `ids` are specified
- **THEN** the system SHALL return an empty result set and EOSE in memory without executing a database query

#### Scenario: Query targeting mixed authors
- **WHEN** a client submits a `REQ` filter containing both whitelisted and non-whitelisted authors
- **THEN** the system SHALL prune the author list to include only whitelisted authors before executing the query

#### Scenario: COUNT request targeting non-whitelisted authors
- **WHEN** a client submits a `COUNT` request specifying authors where none belong to the authorized whitelist
- **THEN** the system SHALL respond with a count of 0 in memory without executing a database query

### Requirement: Privacy Pre-Filtering
The system SHALL strip private event kinds (Kind 4 and Kind 1059) from unauthenticated queries prior to query generation, and SHALL abort database execution if the kinds filter becomes empty.

#### Scenario: Unauthenticated query targeting exclusively private kinds
- **WHEN** an unauthenticated connection submits a query where the requested `kinds` consist solely of private kinds (Kind 4 or Kind 1059)
- **THEN** the system SHALL return an empty result set in memory without executing a database query

#### Scenario: Unauthenticated query targeting mixed kinds
- **WHEN** an unauthenticated connection submits a query containing both public kinds and private kinds
- **THEN** the system SHALL strip the private kinds and execute the database query using only the remaining public kinds

#### Scenario: Authenticated allowed author querying private kinds
- **WHEN** an authenticated allowed author connection submits a query for private kinds
- **THEN** the system SHALL execute the query against the database and return only the matching private events where the author is the sender or recipient

### Requirement: Session Rate Limiting
The system SHALL enforce sliding-window rate limits (30 requests per 5-second window) on `REQ` messages from unauthenticated connections to prevent automated scraping and abuse while allowing legitimate initial connection bursts.

#### Scenario: Unauthenticated connection exceeding rate limit
- **WHEN** an unauthenticated WebSocket connection sends `REQ` messages exceeding 30 requests within 5 seconds
- **THEN** the system SHALL reject the request with a NOTICE response without executing any database query

### Requirement: HTTP Edge Response Caching
The system SHALL append standard CDN cache control headers to public discovery and metadata HTTP endpoints to reduce Worker invocations.

#### Scenario: Requesting NIP-11 relay information
- **WHEN** an HTTP client requests relay info with `Accept: application/nostr+json`
- **THEN** the response SHALL include a `Cache-Control` header enabling CDN edge caching

#### Scenario: Requesting NIP-05 or NIP-96 discovery metadata
- **WHEN** an HTTP client requests `/.well-known/nostr.json` or `/.well-known/nostr/nip96.json`
- **THEN** the response SHALL include a `Cache-Control` header enabling CDN edge caching
