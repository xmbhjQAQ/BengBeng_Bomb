# 绷绷炸弹 MVP — Technical Design

## 1. Design Principles

1. Reuse the verified gameplay implementation; productize it instead of rewriting it.
2. Keep video bytes on the Bilibili CDN and all face inference in the browser.
3. Make challenge creation stateless; only opened/started challenges create D1 rows.
4. Keep public challenge, private management, and public report capabilities cryptographically separated.
5. Keep all tunable values centralized, while secrets remain exclusively in Worker bindings.
6. Deploy one Cloudflare Worker containing the SPA assets and the low-frequency API surface.

## 2. Repository Shape

The product is a new root-level TypeScript project. Reference directories are read-only migration sources and are not imported by the product.

```text
/
├─ public/
│  └─ vendor/mediapipe/          # copied model, WASM, notices
├─ migrations/                   # D1 schema migrations
├─ src/
│  ├─ client/
│  │  ├─ app/                    # entry shell and entry-mode selection
│  │  ├─ challenge/              # flow state machine and recipient experience
│  │  ├─ composer/               # parse, form, generated links
│  │  ├─ manage/                 # private result view and destroy action
│  │  ├─ report/                 # public result receipt view
│  │  ├─ media/                  # ArtPlayer, danmaku and playback guards
│  │  ├─ vision/                 # camera, MediaPipe, calibration and scoring
│  │  ├─ sharing/                # canvas cards, QR and Web Share/download
│  │  ├─ api/                    # typed HTTP client and boundary decoding
│  │  └─ ui/                     # reusable components and visual tokens
│  ├─ shared/
│  │  ├─ contracts/              # API/token DTOs and runtime decoders
│  │  ├─ config/                 # non-secret defaults and limits
│  │  └─ domain/                 # common status/outcome/value objects
│  └─ worker/
│     ├─ routes/                 # route handlers only
│     ├─ bilibili/               # bilidirect adapter and response sanitation
│     ├─ capabilities/           # challenge/manage/report token signing
│     ├─ repositories/           # D1 statements and result aggregation
│     ├─ security/               # validation, hashing, headers and errors
│     └─ index.ts                # fetch + scheduled handlers
├─ tests/                        # integration and security regression tests
├─ wrangler.jsonc
├─ vite.config.ts
└─ package.json
```

No production source file may import from `模块化开发及技术验证成果` or `已有后端`.

## 3. Runtime Architecture

```text
Browser SPA
  ├─ camera → local MediaPipe → calibration/scoring → one final result
  ├─ video element ───────────────────────────────→ Bilibili CDN
  └─ low-frequency JSON/XML requests → Cloudflare Worker
                                          ├─ signed capability service
                                          ├─ D1 temporary state/statistics
                                          └─ bilidirect upstream → Bilibili API/XML
```

- Worker static assets use SPA fallback; `/api/*` runs Worker-first.
- The browser never receives `BILIDIRECT_API_KEY` or `APP_SIGNING_SECRET`.
- Worker never proxies video bodies. It returns sanitized temporary CDN candidates.
- Danmaku may flow through Worker to bilidirect because XML CORS/auth needs a trusted hop.

## 4. Configuration Boundaries

### Client-safe configuration

`src/shared/config/client.ts` owns input limits, display defaults, MediaPipe asset paths, camera dimensions, target FPS, calibration parameters, scoring thresholds, face grace/recovery/countdown values, player timeouts and heatmap bucket size. Existing verified defaults are migrated from the demo and normalized in one place.

### Worker non-secret variables

Configured in `wrangler.jsonc` per environment and parsed once by `src/worker/config.ts`:

- `CHALLENGE_TTL_HOURS=48`
- `RESULT_TTL_HOURS=48`
- `VIDEO_TICKET_TTL_MINUTES=15`
- `BILIDIRECT_BASE_URL=<deployment endpoint>`
- `BILIBILI_QN=80`
- optional allowed-origin and operational limit values

### Worker secrets

Configured with Wrangler Secret/local `.dev.vars`, never committed or exposed:

- `APP_SIGNING_SECRET`
- `BILIDIRECT_API_KEY`

`.dev.vars.example` contains names and placeholders only. Runtime startup rejects absent or weak signing secrets.

## 5. Capability Tokens

All tokens use canonical UTF-8 JSON, Base64URL without padding and HMAC-SHA-256 through Web Crypto. A version prefix and domain-separated signing label prevent token-type confusion.

### Public challenge token: `bc1.<payload>.<signature>`

Payload includes only stable, non-secret fields:

- schema version and capability kind
- source (`bilibili`), BVID, CID and page
- bounded title/cover summary needed for graceful initial rendering
- initiator nickname, optional recipient nickname and bounded message
- created/expiry Unix times, random nonce and mode/config version

It never contains a CDN playback URL, upstream Key, manage token, result secret or Worker secret. `challengeId` is a truncated Base64URL SHA-256 digest of the complete validated public token.

### Private manage token: `bm1.<challengeId>.<signature>`

The signature is HMAC over a distinct `manage:v1` domain. It is returned only once at creation. The supplied manage URL stores both manage and public challenge tokens in the URL fragment so tokens do not enter access logs or referrers; the public token is decoded locally for presentation.

### Public report token: `br1.<payload>.<signature>`

Created only after an idempotent completion. It carries a bounded, non-management result receipt (video identity, outcome, elapsed/failed time, issue/expiry time and nonce). It grants no result deletion or private status access and expires with the private result window.

Token decoders are centralized in `src/shared/contracts`; route handlers and React views consume typed decoded values rather than casting raw JSON.

## 6. API Contracts and Request Budget

Every API response uses `{ ok, data?, error? }` with a stable error code and no secret-bearing diagnostics.

### Creator flow

1. `POST /api/bilibili/parse` — validate direct Bilibili URL/BVID, call bilidirect with server-side Key, sanitize response, return stable metadata, current media candidates, danmaku ticket and a 15-minute signed video ticket.
2. `POST /api/challenges` — validate the video ticket and bounded form fields, create public/manage capabilities, return links. No D1 write.

### Recipient flow

1. `POST /api/challenges/open` — validate public token/expiry, upsert the minimal D1 session, re-resolve current playback data, return sanitized video data and current anonymous stats.
2. `POST /api/challenges/start` — atomically claim the one-time attempt and return a random attempt token; store only its SHA-256 hash. The browser keeps the token in memory/session storage for refresh recovery.
3. `POST /api/challenges/complete` — validate challenge and attempt, accept one final `held|failed` result, atomically mark complete, increment anonymous aggregates once, and return stats plus a public report token.
4. `GET /api/danmaku?...` — validate a short-lived ticket or current challenge capability, fetch XML through bilidirect, set safe CORS/content headers; never proxy media.

### Management/reporting

- `POST /api/manage/result` with manage token in `Authorization` retrieves opened/started/completed status and private result.
- `DELETE /api/manage/result` with the same authorization deletes the private session/result. Anonymous aggregates remain.
- `POST /api/reports/resolve` validates a report token and returns its public receipt plus current video statistics.
- Management views do not poll automatically; they provide explicit refresh.

A normal completed attempt uses a small fixed number of dynamic requests and uploads no frame-level data.

## 7. D1 Model

### `challenge_sessions`

- `challenge_id TEXT PRIMARY KEY`
- `video_key TEXT NOT NULL` (`bvid:cid`)
- `created_at`, `expires_at`, `opened_at`, `started_at`, `completed_at`, `result_expires_at`
- state constrained to `opened|started|completed`
- `attempt_token_hash` (never the bearer token)
- final `outcome`, `failed_at_seconds`, `duration_seconds`
- no nickname, message, public token, camera data, face landmarks or per-frame scores

### `video_stats`

- keyed by `video_key`
- total/held/failed counts and cumulative elapsed seconds
- updated once after the winning completion transition

### `video_fail_buckets`

- `(video_key, bucket_start_seconds)` composite key and count
- powers failure distribution/heatmap without retaining identities

Indexes cover expiry cleanup and video aggregation reads. Completion first performs a conditional `started → completed` update; only the request that changes one row can increment aggregates. D1 batch groups aggregate mutations.

The scheduled handler deletes incomplete rows after their challenge expiry and completed private rows after `result_expires_at`. Aggregate tables intentionally remain.

## 8. Frontend State and UX

### Entry modes

- `/` — composer
- `/c/<public-token>` — recipient SPA
- `/manage#...` — private creator view
- `/report/<report-token>` — public report

These are entry addresses, not route changes during the core recipient flow. The recipient uses one reducer/state machine for:

`intro → permission → face-check → calibrating → calibrated → ready → running ↔ face-paused/recovering → settling → result`

Invalid media interaction, camera interruption, detector termination or page hiding transitions to an explicit invalid/retry state, never a smile failure.

The visual system uses rounded Material-inspired surfaces, tactile controls, restrained depth, high contrast and motion-reduced fallbacks. Native fullscreen is attempted from the start-button gesture; unsupported/iOS cases use a fixed immersive overlay. Responsive layouts prioritize portrait phones while preserving desktop video space.

## 9. Reuse Map

Migrate and improve these verified modules from `B站视频+笑脸检测验证`:

- `bilibili/*`: input parsing, response normalization, cover candidates, media fallback, playback gate and seek lock.
- `camera/*`, `detector/*`: camera lifecycle, inference loop, MediaPipe adapter and local assets.
- `calibration/*`, `scoring/*`: robust baseline and stable classification.
- `challenge/*` and relevant hooks: transition table, buffering, face loss and media-event rules.
- existing tests covering these contracts.

The demo's hard-coded API Key is explicitly not migrated. The product client calls only same-origin Worker APIs. ArtPlayer and MediaPipe cleanup behavior is preserved and expanded with mobile/fullscreen cases.

## 10. Sharing Images

Canvas rendering happens locally. A shared card renderer accepts a typed theme, video preview and either challenge or report content. It loads covers with `referrerPolicy='no-referrer'`, uses a QR library for the public URL, handles tainted-canvas/load failures with a branded fallback, and exports PNG Blob for download/Web Share. Manage URLs are rejected by the renderer contract.

## 11. Security and Privacy

- Validate and normalize all untrusted data at API/token boundaries; enforce byte/character limits before signing.
- Use constant-time signature comparison where practical and generic external errors.
- Set CSP, nosniff, referrer policy, permissions policy and no-store headers for API responses.
- Management bearer tokens stay in URL fragments/client memory and authorization headers.
- Do not log request bodies, credentials or tokens. Structured logs contain request IDs, route/result class and upstream status only.
- Only same-origin frontend calls the public API in normal operation; optional origin checks and Cloudflare protections may be layered without changing contracts.
- Explicitly disclose that deleted/expired private results leave irreversible anonymous aggregate counts.

## 12. Compatibility, Failure and Rollback

- Camera requires HTTPS/localhost. Unsupported browsers receive a clear capability check before permission.
- Web Share, fullscreen and clipboard are progressive enhancements with download/copy/immersive fallbacks.
- Danmaku failure does not invalidate the challenge; video or detector failure does.
- Bilibili response drift is isolated in one adapter with fixtures and multiple media candidates.
- Database migration is additive. Deployment rollback restores the previous Worker bundle; schema remains backward-compatible through v1.
- `APP_SIGNING_SECRET` rotation invalidates outstanding v1 capabilities unless a previous-key verification binding is deliberately configured later; rotation procedure is documented.

## 13. Risks and Deferred Items

- Bilibili API/CDN behavior and terms can change; the adapter and VPS remain replaceable.
- No client-only mechanism can stop a determined user from modifying browser code; controls enforce the intended casual challenge experience, not adversarial anti-cheat.
- Face-expression accuracy varies with lighting, devices and individual expression. Configurable thresholds and neutral calibration reduce but cannot eliminate false positives.
- Broad short-link resolution, accounts, permanent reports, notifications and production deployment authorization remain outside MVP.
