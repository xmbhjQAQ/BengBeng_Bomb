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
