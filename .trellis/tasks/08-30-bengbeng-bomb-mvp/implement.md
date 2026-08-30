# 绷绷炸弹 MVP — Implementation Plan

## Delivery Strategy

Keep this as one integration task because the stateless capabilities, D1 lifecycle, player state machine and recipient UI share versioned contracts and must ship together. Work proceeds in independently verifiable checkpoints; every checkpoint must leave type-checks and focused tests green.

## Ordered Checklist

### 1. Scaffold the standalone product

- [ ] Create the root React + TypeScript + Vite + Cloudflare Workers project and scripts.
- [ ] Configure Worker static asset SPA fallback with `/api/*` Worker-first routing.
- [ ] Add modular source directories, strict TypeScript, lint/test configs and path aliases.
- [ ] Add `wrangler.jsonc`, D1 binding/migrations, `.dev.vars.example`, `.gitignore`, license notices and safe configuration defaults.
- [ ] Copy MediaPipe model/WASM/license assets into root `public/vendor`; ensure no product import/reference points at the validation directories.

Validation: install succeeds; empty shell builds; Worker local config parses; dependency/license files are present.

### 2. Establish shared contracts and configuration

- [ ] Define domain types for video identity/metadata, challenge payload, manage/report capabilities, session status, result and aggregate stats.
- [ ] Implement boundary decoders/normalizers with size, enum, number and timestamp validation.
- [ ] Create one client-safe configuration module and one Worker env parser with configurable 48-hour challenge/result TTL defaults.
- [ ] Add consistent API success/error envelopes and client decoder.

Validation: unit tests cover invalid/empty/oversized values, TTL overrides and response round trips.

### 3. Implement capability security

- [ ] Implement canonical JSON Base64URL helpers, SHA-256 identifiers and HMAC-SHA-256 sign/verify.
- [ ] Add domain-separated public challenge, private manage, short-lived video/danmaku ticket and public report codecs.
- [ ] Generate cryptographic nonce/attempt values; store no bearer management/attempt token in D1.
- [ ] Build URLs so manage tokens live in fragments; add tests proving public/manage/report types cannot substitute for one another.

Validation: deterministic fixtures, tamper/expiry/wrong-kind/wrong-key tests and secret-leak assertions.

Rollback point: capability format is versioned `v1`; do not start UI integration until fixtures are stable.

### 4. Implement Worker Bilibili adapter and D1 lifecycle

- [ ] Adapt bilidirect calls behind server-only endpoint/Key bindings and sanitize all returned URLs/metadata.
- [ ] Implement creator parse + video ticket, challenge creation, open/resolve, start claim, completion, danmaku, manage get/delete and report resolve routes.
- [ ] Add D1 repository methods and migration for session, aggregate and failure buckets.
- [ ] Make completion and aggregation idempotent under repeats/concurrency.
- [ ] Add scheduled expiry cleanup for 48-hour incomplete challenges and 48-hour post-completion private results.
- [ ] Add safe headers, request IDs and redacted error/log behavior.

Validation: Worker integration tests use bilidirect fixtures and local D1 migrations; assert request count, no media proxying, no secret fields, deletion semantics and persistent anonymous aggregates.

Rollback point: migration remains additive; do not remove or rename v1 columns during MVP implementation.

### 5. Migrate and harden verified gameplay modules

- [ ] Migrate camera, detector, inference loop, calibration, scoring and result creation with existing tests.
- [ ] Migrate Bilibili input/metadata normalization, ArtPlayer/danmaku integration, media candidate fallback, playback gate and seek interaction lock.
- [ ] Migrate the challenge transition machine and media/visibility guards; adapt it to product phases and API completion.
- [ ] Remove demo runtime API Key/config behavior and replace it with same-origin typed API calls.
- [ ] Preserve proper resource cleanup and add mobile/fullscreen, keyboard and session-refresh behavior.

Validation: migrated unit/component suites pass; tests prove no camera/score upload and rule-breaking produces invalid rather than failed results.

### 6. Build creator composition and sharing

- [ ] Build Material-inspired responsive shell, link parser form, metadata preview and bounded challenge form.
- [ ] Generate/display public and private links with explicit warnings and copy affordances.
- [ ] Implement a reusable local canvas card renderer, QR generation, download and Web Share fallback.
- [ ] Ensure covers use controlled `<img referrerPolicy="no-referrer">` and canvas has a safe fallback when cross-origin pixels are unavailable.

Validation: component tests for errors/limits/loading/success; generated QR decodes to public link only; artifact scan rejects secrets/manage token in public output.

### 7. Build the single-page recipient challenge

- [ ] Implement intro/privacy/consent before any camera call.
- [ ] Add face positioning and calibration feedback, paused preloaded player and explicit start gesture.
- [ ] Add immersive/fullscreen layout, status badge, camera bubble, volume and danmaku controls.
- [ ] Add face-loss overlay, stabilization and countdown recovery; keep media events synchronized with the reducer.
- [ ] Submit exactly one final result and show retry/recovery states for network or invalidated attempts.

Validation: component/state-machine scenarios cover permission denied, no face, multiple face, unstable calibration, danger recovery, sustained failure, completion, buffering, page hide, illegal media action and API retry.

### 8. Build settlement, management and reports

- [ ] Render consistent held/failed settlement layouts with personal result, percentile approximation and anonymous aggregates/heatmap.
- [ ] Generate public report link/image with no management capability.
- [ ] Implement “转发给朋友” return-to-composer with video prefill and new nonce generation.
- [ ] Implement private status/result view with manual refresh, destroy confirmation, expired/deleted states and aggregate-retention disclosure.

Validation: full mocked flows from create → open → start → complete → manage/report/destroy; statistics remain after private deletion.

### 9. Visual, accessibility and compatibility pass

- [ ] Finish responsive phone/desktop layouts, focus order, labels, contrast, reduced-motion and touch targets.
- [ ] Verify fullscreen fallback, Web Share/download fallback, clipboard fallback, camera secure-context messaging and iOS inline/fullscreen behavior.
- [ ] Add empty/loading/error/expired/already-started/already-completed states.

Validation: automated accessibility smoke checks where available plus manual viewport/capability checklist documented in README.

### 10. Final quality and deployment readiness

- [ ] Run formatting/lint, type-check, all unit/component/Worker integration tests and production build.
- [ ] Search built and source artifacts for real endpoint Key/secret/cookie and forbidden reference-directory imports.
- [ ] Verify deleting/renaming both reference directories does not affect build or tests (use an exclusion/static dependency audit rather than destructive deletion).
- [ ] Document local HTTPS/camera development, local D1 migrations, secret setup, config overrides, deploy/rollback, data retention and Bilibili limitations.
- [ ] Run Trellis full quality review and address verified findings.

## Validation Commands

The scaffold will expose these stable commands:

```powershell
npm run type-check
npm run lint
npm test
npm run test:worker
npm run build
npm run check
```

Additional deployment checks:

```powershell
npx wrangler d1 migrations apply bengbeng-bomb-db --local
npx wrangler dev
npx wrangler deploy --dry-run
```

Network-dependent install/docs/deploy commands require the normal approval boundary. A real deployment is not performed without Cloudflare account authorization.

## Review Gates

1. Capability/token tests must pass before exposing generated links in UI.
2. D1 lifecycle/idempotency tests must pass before wiring final result submission.
3. Existing gameplay tests must pass immediately after migration and again after UX integration.
4. No security or privacy acceptance criterion may be deferred to post-MVP.
5. Final full-scope check must verify every PRD acceptance criterion and all cross-layer DTOs.

## High-Risk Areas

- Capability canonicalization and cross-token confusion.
- D1 completion/aggregate races and retention cleanup.
- Bilibili response drift, expiring media and Referer/CORS behavior.
- Browser media event ordering, fullscreen differences and illegal seek/pause false positives.
- Canvas cover CORS/taint behavior and accidental management-token QR generation.
- MediaPipe asset paths, mobile performance and camera cleanup.

## Rollback Strategy

- Keep token/data schemas versioned and backward-readable throughout v1.
- Keep D1 changes additive; rollback Worker code without destructive schema operations.
- Preserve the verified gameplay modules' test fixtures while product UI evolves.
- Each checklist checkpoint should be reviewable and revertible without deleting user/reference files.
