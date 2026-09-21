## Why

While data-layer indexing ensures efficient database operations, unauthenticated clients, crawlers, and third-party Nostr clients still submit queries for unknown authors, request private messages, or spam the relay with polling requests. Executing database lookups for data that is known not to exist or not permitted to be returned unnecessarily consumes Cloudflare D1 query limits and Worker CPU time.

This change introduces application-layer guardrails to short-circuit invalid or unauthorized queries in memory before reaching D1, protect private event types, enforce session rate limiting on unauthenticated connections, and leverage Cloudflare edge caching for public HTTP metadata endpoints.

## What Changes

- **Whitelist Circuit Breaker**: Intersect query `authors` against `getAllowedAuthors(env)`. If a query specifies authors but none match the authorized whitelist (and no specific `ids` are requested), immediately return empty results in memory without invoking D1. Apply the same short-circuit logic to NIP-45 `COUNT` requests.
- **Privacy Pre-Filtering**: When unauthenticated clients query direct messages (Kind 4) or GiftWraps (Kind 1059), strip these private kinds prior to querying D1. If the query's `kinds` list becomes empty after stripping, return empty results immediately without running a database query.
- **Session Rate Limiting**: Implement a sliding-window rate limiter for unauthenticated WebSocket connections to prevent automated crawlers or misconfigured clients from spamming `REQ` messages.
- **HTTP Edge Caching**: Add standard `Cache-Control` response headers (`public, max-age=3600, s-maxage=86400`) to NIP-11 (`application/nostr+json`), NIP-05 (`/.well-known/nostr.json`), and NIP-96 info endpoints to offload repeat requests to Cloudflare's CDN.

## Capabilities

### New Capabilities
- `request-guard`: Application-level query short-circuiting, privacy filtering, session rate limiting, and HTTP response caching for the Nostr relay.

### Modified Capabilities
*(None)*

## Impact

- **Code Affected**: [`src/index.js`](file:///F:/go_project/cfrelay/src/index.js) (`handleSession`, `doReq`, `doCount`, `fetch`).
- **Database**: Drastically reduces D1 read calls by filtering out non-whitelisted and unauthorized queries before reaching the database layer.
- **Protocol & Security**: Strict preservation of Nostr NIP-01 and NIP-42 compliance; unauthenticated users cannot probe private DMs.
