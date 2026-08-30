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
GET    /api/health
```

Capability prefixes are fixed for v1:

```text
bc1 = public challenge
bm1 = private manage
br1 = public report
bv1 = short-lived video ticket
```

D1 tables are `challenge_sessions`, `video_stats`, and `video_fail_buckets`. Session state is `opened | started | completed`.

### 3. Contracts

- Every JSON response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
- `/api/bilibili/parse` accepts `{ input: string }`, validates a direct `bilibili.com/video/BV...` URL or exact BVID, sends `BILIDIRECT_API_KEY` only in the server-to-server `X-API-Key` header, and returns sanitized metadata/media plus a short-lived video ticket.
- `/api/challenges` accepts the video ticket plus bounded `initiator`, optional `recipient`, and optional `message`. It signs public/manage capabilities and performs no D1 write.
- `/api/challenges/open` validates `bc1`, upserts the first D1 row, refreshes CDN media, and returns the ticketed same-origin danmaku route.
- `/api/challenges/start` stores only SHA-256 of the random attempt bearer.
- `/api/challenges/complete` accepts one `held | failed` result and elapsed seconds; only the winning `started → completed` update increments aggregates.
- D1 never stores nicknames, messages, public/manage tokens, camera frames, landmarks, blendshapes, or per-frame scores.
- Required secrets: `APP_SIGNING_SECRET` (at least 32 characters), `BILIDIRECT_API_KEY`.
- Non-secret variables: `BILIDIRECT_BASE_URL`, `CHALLENGE_TTL_HOURS`, `RESULT_TTL_HOURS`, `VIDEO_TICKET_TTL_MINUTES`, `BILIBILI_QN`.
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

### 5. Good/Base/Bad Cases

- Good: creator parse → signed stateless challenge → recipient open/start/complete → private result deletion while aggregate counters remain.
- Base: danmaku upstream fails but direct CDN media remains playable; no video proxy route exists.
- Bad: putting `media`, `directUrl`, `bm1`, API keys, or cookies inside `bc1`, report payloads, logs, or D1.

### 6. Tests Required

- Capability tests assert tamper rejection, expiry, prefix separation, canonical round trip, and stripping of temporary CDN fields.
- Adapter tests assert server-only `X-API-Key`, HTTPS normalization, allowed direct link hosts, and no credential in returned JSON.
- Config tests assert default/override bounds and weak-secret rejection.
- HTTP tests assert no-store API responses and CSP/Permissions Policy on static assets.
- D1/runtime validation must cover first-write open, one-time start, idempotent completion, aggregate-once behavior, manage deletion, and scheduled/on-read expiry.
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
