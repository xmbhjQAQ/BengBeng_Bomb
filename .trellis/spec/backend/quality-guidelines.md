# Backend Quality Guidelines

## Scenario: Temporary challenge capabilities and lifecycle APIs

### 1. Scope / Trigger

- Trigger: any change to Worker routes, signed tokens, bilidirect integration, D1 session/result storage, retention configuration, or scheduled cleanup.
- Goal: challenge creation remains stateless, public/private capabilities cannot be confused, video bytes never pass through the Worker, and private data expires independently of anonymous aggregates.

### 2. Signatures

Worker routes:

```text
POST   /api/bilibili/parse
POST   /api/challenges
POST   /api/challenges/open
POST   /api/challenges/start
POST   /api/challenges/complete
GET    /api/danmaku
POST   /api/manage/result       Authorization: Bearer bm1...
DELETE /api/manage/result       Authorization: Bearer bm1...
POST   /api/reports/resolve
GET    /api/leaderboard
GET    /api/health
```

Capability prefixes are fixed for v1:

```text
bc1 = public challenge
bm1 = private manage
br1 = public report
bv1 = short-lived video ticket
```

D1 tables are `challenge_sessions`, `challenge_score_traces`, `video_stats`, `video_fail_buckets`, and `video_catalog`. Session state is `opened | started | completed`.

### 3. Contracts

- Every JSON response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
- `/api/bilibili/parse` accepts `{ input: string }`, validates a direct `bilibili.com/video/BV...` URL or exact BVID, sends `BILIDIRECT_API_KEY` only in the server-to-server `X-API-Key` header, and returns sanitized metadata/media plus a short-lived video ticket.
- `/api/challenges` accepts `mode: classic | self`. Classic requires bounded `initiator` and allows recipient/message; self ignores identity fields and signs a nickname-free “单人挑战”. It performs no D1 write.
- `/api/challenges/open` validates `bc1`, upserts the first D1 row, refreshes CDN media, and returns the ticketed same-origin danmaku route.
- `/api/challenges/start` stores only SHA-256 of the random attempt bearer.
- `/api/challenges/complete` accepts one `held | failed` result, elapsed seconds and at most 600 strictly increasing `{ timeSeconds, score }` points. Only the winning `started → completed` batch writes the immutable trace and increments aggregates.
- `/api/reports/resolve` returns the trace only through a valid report capability with optional backward-compatible `resultRef`; an old report returns an empty trace.
- `/api/leaderboard` returns permanent anonymous video aggregates filtered by the configured minimum, ordered by the shared 70% failure/30% elapsed formula, and read-through cached for a short public TTL.
- D1 never stores nicknames, messages, public/manage tokens, camera frames, landmarks, blendshapes, raw per-frame scores, or temporary media URLs. It may store only the bounded 0–100 trace projection until `result_expires_at`.
- Required secrets: `APP_SIGNING_SECRET` (at least 32 characters), `BILIDIRECT_API_KEY`.
- Non-secret variables: `BILIDIRECT_BASE_URL`, `CHALLENGE_TTL_HOURS`, `RESULT_TTL_HOURS`, `VIDEO_TICKET_TTL_MINUTES`, `BILIBILI_QN`, `LEADERBOARD_MIN_ATTEMPTS`, `LEADERBOARD_CACHE_SECONDS`, `LEADERBOARD_LIMIT`.
- Default challenge and post-completion result TTLs are both 48 hours and are parsed only in `src/worker/config.ts`.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Unsupported host/short link/missing BVID | 400 envelope; never call bilidirect |
| Invalid, tampered, or wrong-kind capability | stable `INVALID_*` error; never accept another prefix |
| Expired public/report/video capability | 410 where routed through the Worker |
| Missing manage authorization | 401 `MISSING_AUTHORIZATION` |
| Oversized or invalid JSON | 413 `REQUEST_TOO_LARGE` or 400 `INVALID_JSON` |
| Expired private row before Cron runs | return `expired` and delete it during the management request |
| Attempt hash mismatch | 403 unless returning the already-finalized public result idempotently |
| bilidirect/CDN metadata failure | sanitized `UPSTREAM_ERROR`; never include keys, cookies, or tokens |
| Invalid trace shape/range/order/length | 400 `INVALID_RESULT`; do not update session, trace, bucket or aggregate |
| Completion is retried | return existing completion without overwriting trace or incrementing aggregate |
| Result expires or manage destroys it | remove session and trace together; permanent anonymous video aggregate remains |
| Leaderboard cache unavailable | query D1 and return the same public envelope; caching is an optimization only |

### 5. Good/Base/Bad Cases

- Good: creator/self parse → signed stateless challenge → recipient open/start/atomic complete+trace → report resolves bounded trace → private result deletion while permanent anonymous counters remain.
- Base: danmaku upstream fails but direct CDN media remains playable; no video proxy route exists.
- Bad: putting `media`, `directUrl`, `bm1`, API keys, cookies, face landmarks, or an unbounded trace inside capabilities, logs, or D1.

### 6. Tests Required

- Capability tests assert tamper rejection, expiry, prefix separation, canonical round trip, and stripping of temporary CDN fields.
- Adapter tests assert server-only `X-API-Key`, HTTPS normalization, allowed direct link hosts, and no credential in returned JSON.
- Config tests assert default/override bounds and weak-secret rejection.
- HTTP tests assert no-store API responses and CSP/Permissions Policy on static assets.
- D1/runtime validation must cover first-write open, one-time start, idempotent completion, aggregate-once behavior, manage deletion, and scheduled/on-read expiry.
- Trace tests assert validation before writes, atomic first completion, immutable retry, exact result TTL, old-report compatibility, and manage/scheduled cleanup.
- Leaderboard tests assert video catalog stores stable metadata only, minimum/config bounds, formula clamps/rounding, deterministic ties, GET envelope, cache hit/miss/fallback and error non-caching.
- Run `npm run test:worker`, `npm run check`, local migrations, and `wrangler deploy --dry-run` before deployment.

### 7. Wrong vs Correct

#### Wrong

```ts
// Exposes the upstream secret and lets a temporary CDN URL become public state.
return json({ key: env.BILIDIRECT_API_KEY, challenge: playback });
```

#### Correct

```ts
const playback = await resolveBilibili(bvid, page, config, env.BILIDIRECT_API_KEY);
const stableVideo = decodeVideoMetadata(playback); // strips `media`
return issueChallenge({ ...payload, video: stableVideo }, env.APP_SIGNING_SECRET);
```

Keep the trace bounded and the aggregate update behind the same winning state transition:

```ts
const scoreTrace = decodeScoreTrace(body.scoreTrace, video.duration);
await repo.completeAtomic({ id, outcome, elapsed, scoreTrace, resultExpiresAt });
```
