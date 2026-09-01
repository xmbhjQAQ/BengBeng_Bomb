# Release Hardening Contracts

## 1. Scope / Trigger

This contract applies when changing capability authorization, public URL generation, upstream bilidirect calls, optional rate limiting, static security headers, or scheduled retention cleanup.

## 2. Signatures

```ts
readConfig(env: Env): WorkerConfig
checkRateLimit(binding, request, kind): Promise<boolean>
SessionRepository.cleanup(now): Promise<{ traceChanges: number; sessionChanges: number; changes: number }>
GroupRepository.cleanup(now): Promise<{ parentChanges: number; attemptChanges: number; blockChanges: number; changes: number }>
```

## 3. Contracts

- Completion must verify the attempt-token hash before reading or issuing any report, including retries after `completed`.
- `PUBLIC_ORIGIN` is the only non-local base for generated links; request `Host` is not trusted for production links.
- bilidirect reads have bounded timeout/body size and require the expected status/content type.
- A bilidirect request may make up to `BILIDIRECT_MAX_RETRIES` additional attempts for a transient 502/503/504 or transport failure. The setting defaults to `3`, accepts `0` (disabled), and is bounded to `0–5` to protect Cloudflare Free-account subrequest usage. Retries use a small bounded delay within the same total timeout budget; they must not honor an upstream long `Retry-After` synchronously.
- 4xx/authentication failures, invalid content types, malformed payloads and body-size failures are not retried. Every failed response body is released before the adapter returns an error.
- Rate-limit keys are SHA-256 digests of route/method/client address; raw addresses, tokens and payloads are never logged or persisted.
- Cron logs contain only elapsed milliseconds and category counts (`single.trace`, `single.session`, `group.parent`, `group.attempt`, `group.block`). TTL and aggregate-retention semantics remain unchanged.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Wrong, malformed or oversized capability | Stable 4xx/expired error; no token reflection or side effect |
| Missing production origin/resource binding | Release preflight fails before deploy |
| Upstream timeout/oversize/non-JSON | Stable upstream error; no unbounded wait/read |
| Limiter unavailable | Fail open with a redacted error log; limiter hit returns 429 + `Retry-After` |
| Cleanup failure | Log category-free error name and duration, then rethrow for scheduler visibility |

## 5. Good / Base / Bad Cases

- Good: valid bearer completes once; a retry with the same bearer is immutable and a different bearer receives 403.
- Base: local development omits `PUBLIC_ORIGIN` and optional limiters while production preflight requires them.
- Bad: deriving share links from `Host`, logging full capability URLs, or marking unversioned model files immutable.

## 6. Tests Required

- Capability and completion tests assert wrong-bearer rejection before and after completion.
- Config/preflight tests reject placeholder IDs, weak/empty secrets, invalid origins and missing target bindings.
- Upstream tests cover timeout, status/content type and stream-size limits.
- Rate-limit tests assert hashed keys, 429 headers and fail-open behavior.
- Repository tests assert classified cleanup counts while preserving the `changes` total.

## 7. Wrong vs Correct

```ts
// Wrong: completed state bypasses the bearer check.
if (row.state === 'completed') return issueReport(row);

// Correct: authorization is checked first for every state.
if (!await repo.attemptMatches(id, await sha256(attemptToken))) return failure('INVALID_ATTEMPT', '本轮挑战凭证无效', 403);
```

## Scenario: CF Tunnel transient upstream jitter

### 1. Scope / Trigger

- Trigger: the bilidirect origin is exposed through a Cloudflare Tunnel or another intermittently unavailable network path.
- Goal: absorb a bounded number of short-lived origin handshake/transport failures without multiplying Worker subrequests beyond the configured Free-account-safe cap or waiting on an unbounded upstream retry delay.

### 2. Signatures

```ts
resolveBilibili(bvid, page, config, apiKey, fetchImpl?, sleepImpl?): Promise<PlaybackData>
fetchDanmaku(cid, bvid, config, apiKey, fetchImpl?, sleepImpl?): Promise<string>
```

`BILIDIRECT_TIMEOUT_MS` remains the total deadline for the operation, including the optional retry and its delay.

`BILIDIRECT_MAX_RETRIES` controls additional attempts after the first request. Its default is `3`, `0` disables retry, and the accepted range is `0–5`; therefore total upstream attempts are always `1 + configured retries` (before the shared deadline prevents another attempt).

### 3. Contracts

- The first attempt starts the single total deadline. The adapter performs no more than `1 + BILIDIRECT_MAX_RETRIES` upstream attempts, and never more than six after config/direct-call clamping.
- Each additional attempt is allowed only after a 502, 503, 504, or a transport failure mapped to one of those retryable upstream errors. The delay is short and bounded (currently 150 ms), and an upstream `Retry-After` value must not block the Worker for its full duration.
- The retry shares the remaining deadline; a slow first attempt cannot reset the timeout for a second full-length attempt.
- The adapter cancels/release failed response bodies, keeps API credentials in the server-only request header, and returns the existing sanitized `UPSTREAM_ERROR` mapping.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| A retryable 502/503/504 or transport failure, then a later attempt succeeds | Return the normal sanitized playback/danmaku result |
| All configured attempts fail | Return the final sanitized upstream/timeout error; never exceed `1 + BILIDIRECT_MAX_RETRIES` requests |
| 4xx/authentication response | Return the upstream error once; do not retry |
| Invalid content type, malformed JSON/XML or oversized body | Return the existing format/size error; do not retry |
| Remaining total deadline is shorter than retry delay | Return the first failure without waiting beyond the deadline |

### 5. Good / Base / Bad Cases

- Good: transient Tunnel errors are followed by a quick successful parse within the configured deadline.
- Base: the origin remains unavailable; the user receives a retryable friendly error and the Worker makes only the configured bounded number of subrequests (four by default).
- Bad: retrying 4xx or malformed content, honoring a 60-second `Retry-After` inside the request, resetting the deadline per attempt, or logging the API key/response body.

### 6. Tests Required

- Assert the default three retries, configured retry counts including zero, the five-retry safety cap, and each 502/503/504/transport classification with the bounded delay injected rather than real-waited.
- Assert 4xx/authentication, invalid content type and size failures make one request only.
- Assert retryable failures followed by a hanging request abort at the original total deadline and never exceed the configured attempt count.
- Assert final and discarded retry responses release their bodies and errors contain no credentials or response body.

### 7. Wrong vs Correct

#### Wrong

```ts
for (;;) {
  const response = await fetch(origin);
  if (response.status >= 500) await delay(Number(response.headers.get('Retry-After')) * 1000);
}
```

#### Correct

```ts
// Configured bounded retries share the original deadline; 4xx and malformed bodies exit immediately.
const response = await fetchWithRetry(origin, init, timeoutMs, maxRetries, fetchImpl, sleepImpl);
```
