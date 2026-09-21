## Context

With data-layer optimizations complete, all queries that execute in Cloudflare D1 efficiently utilize indexes. However, third-party clients and internet crawlers frequently submit queries for authors not hosted on this personal relay, or query private messages without authentication. Executing these queries against D1 still incurs query invocation and CPU overhead.

See `proposal.md` for motivation and background.

## Goals / Non-Goals

**Goals:**
- Short-circuit queries targeting non-whitelisted authors in memory without invoking D1.
- Pre-filter private event kinds (Kind 4 and Kind 1059) for unauthenticated connections, aborting before database access if no valid kinds remain.
- Enforce per-session sliding-window rate limits on unauthenticated WebSocket clients.
- Add HTTP `Cache-Control` headers for public metadata endpoints (NIP-11, NIP-05, NIP-96) to enable Cloudflare CDN edge caching.

**Non-Goals:**
- In-memory event content caching (deferred per user decision to keep memory footprint minimal and implementation simple).
- Modifying database tables or index schemas (finalized in `event-storage`).

## Decisions

### 1. In-Memory Whitelist Short-Circuiting in `doReq` and `doCount`
- **Decision**: Before executing `doQueryEvent` or `doQueryCount`, evaluate `filter.authors`:
  - If `filter.authors` is provided:
    - Compute intersection with `getAllowedAuthors(env)`.
    - If intersection is empty and `filter.ids` is empty, short-circuit and return `[]` (for `doReq`) or `0` (for `doCount`) directly in memory.
    - If intersection has matching authors, replace `filter.authors` with the intersection.
- **Rationale**: The relay only stores data for `getAllowedAuthors(env)`. Querying D1 for authors known not to exist is a pure waste of D1 quotas.

### 2. Privacy Pre-Filtering & Empty-Kind Abort Logic
- **Decision**: In `preprocessFilter(env, filter, authorPubkey)` and `doReq`:
  - If the caller is not an authorized author (`!checkAllowedAuthor(env, authorPubkey)`):
    - If `filter.kinds` is specified:
      - Filter out `4` and `1059` from `filter.kinds`.
      - **Critical Rule**: If `filter.kinds` becomes empty (e.g., client queried only `[4]` or `[1059]`), immediately abort query and return `[]` without touching D1.
  - In a multi-author relay, ensure an allowed author only receives private events where they are either the sender (`event.pubkey`) or recipient (`p` tag).
- **Rationale**: Prevents unauthenticated or unauthorized users from forcing the database to read private messages, ensuring both privacy security and query efficiency.

### 3. Per-Session Sliding-Window Rate Limiter
- **Decision**: Maintain a `reqTimestamps` array within `handleSession`:
  - For unauthenticated connections (`!isAllowedAuthor`), prune timestamps older than 5 seconds (5000ms).
  - If count exceeds burst threshold (30 requests per 5 seconds), reject with `NOTICE` and skip database access.
- **Rationale**: Requires zero external dependencies or KV storage, directly protecting the Worker from rapid polling loops while accommodating modern Nostr clients that split filters into multiple concurrent subscriptions upon connecting.

### 4. CDN Edge Caching for HTTP Discovery Endpoints
- **Decision**: Attach `Cache-Control: public, max-age=3600, s-maxage=86400` to:
  - Relay information document (`Accept: application/nostr+json`)
  - NIP-05 identifier lookup (`/.well-known/nostr.json`)
  - NIP-96 upload API info (`/.well-known/nostr/nip96.json`)
- **Rationale**: These endpoints return static configuration. Caching them at Cloudflare edge nodes eliminates unnecessary Worker compute triggers.

## Risks / Trade-offs

- **[Risk] Legitimate client batch subscriptions hitting rate limits** → *Mitigation*: The rate limiter allows a burst capacity (30 requests per 5-second window) sufficient for initial client multi-subscription bursts, while throttling sustained high-frequency polling.
- **[Risk] Client queries for specific event IDs without author filter** → *Mitigation*: The whitelist circuit breaker only short-circuits if `filter.ids` is also empty, ensuring point lookups by event ID continue to resolve.
