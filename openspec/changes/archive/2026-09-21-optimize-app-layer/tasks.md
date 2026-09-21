## 1. Whitelist Circuit Breaker

- [x] 1.1 Implement author whitelist pre-check in `doReq` to short-circuit non-whitelisted queries in memory
- [x] 1.2 Implement author whitelist pruning for mixed-author filters in `doReq`
- [x] 1.3 Implement author whitelist short-circuiting in `doCount` (return 0 in memory)

## 2. Privacy Pre-Filtering

- [x] 2.1 Strip private kinds (Kind 4 and Kind 1059) from `filter.kinds` for unauthenticated (`!isOwner`) requests in `doReq`
- [x] 2.2 Abort database execution and return empty results immediately in memory if `filter.kinds` becomes empty after stripping

## 3. Session Rate Limiting

- [x] 3.1 Implement per-session sliding-window rate limiter in `handleSession` for unauthenticated connections (`!isOwner`)
- [x] 3.2 Send `NOTICE` response and skip processing when an unauthenticated connection exceeds the rate limit

## 4. HTTP Edge Caching Headers

- [x] 4.1 Add `Cache-Control: public, max-age=3600, s-maxage=86400` to NIP-11 relay info header in `src/index.js`
- [x] 4.2 Add `Cache-Control: public, max-age=3600, s-maxage=86400` to NIP-05 and NIP-96 JSON headers in `src/index.js`

## 5. Verification & Validation

- [x] 5.1 Verify whitelist circuit breaker returns empty in memory without calling D1 for stranger authors
- [x] 5.2 Verify unauthenticated query for Kind 4 aborts without querying D1
- [x] 5.3 Verify sliding-window rate limiting throttles rapid unauthenticated requests
- [x] 5.4 Verify HTTP response headers include CDN cache-control
