# Frontend Quality Guidelines

## Scenario: Local-only face challenge and resolved playback

### 1. Scope / Trigger

- Trigger: changes to recipient flow, MediaPipe/camera/scoring, ArtPlayer, challenge API consumption, share cards, management/report pages, or client-safe tuning.
- Goal: the recipient remains in one SPA flow, face data never leaves the browser, and the player consumes the playback object already returned by `POST /api/challenges/open`.

### 2. Signatures

Key client boundary:

```ts
interface PlaybackData extends VideoMetadata {
  media: string[];
  danmakuUrl?: string;
}

interface SmileDemoController {
  selectResolvedBilibili(playback: PlaybackData): void;
}
```

Recipient phases are reducer-owned and include preparation/calibration, `running`, face-loss grace/pause/recovery/countdown, buffering, invalid, failed, and completed states.

### 3. Contracts

- Request camera permission only from the explicit acceptance button.
- Camera frames, landmarks, blendshapes, raw/smoothed scores, and calibration samples remain local; submit only final outcome and elapsed seconds.
- Call `/api/challenges/open` once, then pass its `PlaybackData` to `selectResolvedBilibili`. Do not call the migrated demo `/api/parse` path again.
- Map `media[0]` to the player primary URL and keep every entry as a fallback candidate; preserve `danmakuUrl`.
- Before consent, show the signed stable cover/title/description/duration plus privacy disclosure.
- The complete recipient sequence—consent, calibration, ready, active, submitting and settlement—stays in one `ChallengeView`, one `/c/<token>` URL and one React page lifetime. Derive the visible stage from the reducer phase plus boundary state; do not navigate, reload or duplicate the gameplay state machine.
- Calibration does not require or mount an interactive player. The ready stage may mount ArtPlayer to become media-ready, but its host must remain `inert`, `aria-disabled` and pointer-locked until the reducer enters an active challenge phase.
- Claim the one-time attempt only from the explicit ready-stage start gesture. Camera/model/calibration failures never call `/api/challenges/start`.
- When a local result exists, close the camera and show an in-page submitting state. A failed completion request retains the same attempt token and immutable local result; retry sends the identical completion payload, and successful completion clears the attempt before rendering settlement in the same component tree.
- Store the attempt bearer only in per-tab `sessionStorage`, never in URLs, images, D1, analytics, or logs.
- During active playback, provide an immersive fixed player, top-left status, top-right circular local camera bubble, and centered face-loss/recovery messaging.
- Treat MediaPipe task creation as a serialized browser-global operation. Try the automatically selected WASM fileset with GPU then CPU; if both fail, retry the bundled `vision_wasm_nosimd_internal` fileset with GPU then CPU. A rejected initialization must not poison later retries.
- React effect cleanup must not close a detector still awaited by a newer StrictMode/retry consumer. Close a shared pending result only after its final consumer releases it.
- Detector initialization errors shown in the UI must remain collapsed behind the friendly recovery message and be length-bounded; redact URLs, local paths, bearer values and token/key/secret assignments before logging or rendering them.
- Share cards accept only public challenge/report URLs, render the video cover with `crossOrigin='anonymous'` and `referrerPolicy='no-referrer'`, and degrade to a branded placeholder.
- All thresholds and timeouts come from `src/shared/config/client.ts`; no component owns private copies.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Camera permission denied/unsupported/insecure | recoverable explanation and retry; no challenge start |
| No/multiple/low-confidence/posed face | grace → pause → stable recovery → countdown; never smile failure |
| Sustained normalized smile | read actual player `currentTime`, stop, submit one failed result |
| Video ends without failure | submit `held` once |
| User pause/seek/rate/page-hide violation | invalidate the attempt, never classify as smile failure |
| Native fullscreen unavailable | fixed immersive layout remains usable |
| Cover CORS failure | placeholder card still exports with a public QR |
| `manage`/`bm1` URL passed to card renderer | throw before QR or canvas export |
| Already started/completed session | show terminal/conflict state rather than starting another attempt |
| Calibration or video still preparing | remain on the current stage; no start API and no interactive player controls |
| Completion request fails | remain on submitting step; retry the same attempt/result without replay or aggregate duplication |
| Any recipient stage transition | pathname/href and page lifetime remain unchanged; fullscreen is display-only |
| SIMD WASM or its GPU/CPU task creation fails | serialize initialization, then retry the bundled no-SIMD fileset without re-requesting camera permission |
| Both WASM variants fail | keep the challenge unclaimed, show the normal retry action, and expose only sanitized bounded technical details |

### 5. Good/Base/Bad Cases

- Good: open returns media/danmaku → consent → isolated local calibration → inert ready player → explicit claim/start → one retry-safe final submission → in-page settlement; public report/private management remain separated.
- Base: cover or danmaku fails independently; core video challenge continues with clear fallback.
- Bad: calling an old parser after open, requesting camera on mount, uploading frame metrics, or embedding a manage URL in a QR.

### 6. Tests Required

- Reducer/scoring/calibration tests cover danger recovery, sustained failure, face loss, buffering and invalid media events.
- `ChallengeView` test asserts open playback is passed directly to `selectResolvedBilibili`, video context is visible before consent, and no second parse request occurs.
- Recipient-flow tests assert only one stage is primary at a time, calibration does not mount the player, the ready player is inert, start is claimed only by the explicit button, pathname/history stay untouched through settlement, and failed submission retries the identical attempt/result before clearing session storage on success.
- Player tests cover play authorization, progress/gesture locking, media fallback and cleanup.
- Camera/detector tests cover permission, track interruption, inference serialization and GPU/CPU adapter output.
- MediaPipe adapter tests assert the exact automatic GPU → automatic CPU → no-SIMD GPU → no-SIMD CPU order, queue recovery after rejection, and sanitized error output.
- Detector hook tests cover StrictMode/pending-request reuse, no premature close, final close exactly once, and a fresh initialization after a completed failure.
- Capability/share tests reject manage URLs and temporary CDN fields.
- Run lint, type-check, all tests, production build, and desktop/mobile visual smoke checks.

### 7. Wrong vs Correct

#### Wrong

```ts
const opened = await post('/api/challenges/open', { challengeToken });
await demo.selectBilibili(`https://www.bilibili.com/video/${opened.challenge.video.bvid}`);
```

This discards the refreshed media/danmaku contract and can call a nonexistent legacy route.

Another forbidden pattern is routing each recipient step or enabling ArtPlayer controls before the attempt starts:

```tsx
navigate(`/c/${token}/calibrate`);
return <ChallengePanel phase="ready" />; // interactive controls still exposed
```

Do not start multiple MediaPipe task creations concurrently or stop at a SIMD-only runtime:

```ts
const fileset = await FilesetResolver.forVisionTasks(wasmDirectory);
return FaceLandmarker.createFromOptions(fileset, options); // no serialization or no-SIMD recovery
```

#### Correct

```ts
const opened = await post<Opened>('/api/challenges/open', { challengeToken });
demo.selectResolvedBilibili(opened.playback);
```

Project the current view from reducer state and lock the ready player instead:

```tsx
const stage = recipientStage({ accepted, phase: demo.phase, hasLocalResult, hasCompletedResult });
return <ChallengePanel active={stage === 'active'} />; // inactive host is inert + pointer-locked
```

Serialize task creation and preserve the runtime/delegate fallback order:

```ts
await enqueueInitialization(async () => {
  try {
    return await createWithDelegateFallback(automaticFileset);
  } catch {
    return createWithDelegateFallback(noSimdFileset);
  }
});
```
