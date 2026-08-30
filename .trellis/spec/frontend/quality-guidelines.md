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
- Store the attempt bearer only in per-tab `sessionStorage`, never in URLs, images, D1, analytics, or logs.
- During active playback, provide an immersive fixed player, top-left status, top-right circular local camera bubble, and centered face-loss/recovery messaging.
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

### 5. Good/Base/Bad Cases

- Good: open returns media/danmaku → local calibration → controlled playback → one final submission → public report/private management remain separated.
- Base: cover or danmaku fails independently; core video challenge continues with clear fallback.
- Bad: calling an old parser after open, requesting camera on mount, uploading frame metrics, or embedding a manage URL in a QR.

### 6. Tests Required

- Reducer/scoring/calibration tests cover danger recovery, sustained failure, face loss, buffering and invalid media events.
- `ChallengeView` test asserts open playback is passed directly to `selectResolvedBilibili`, video context is visible before consent, and no second parse request occurs.
- Player tests cover play authorization, progress/gesture locking, media fallback and cleanup.
- Camera/detector tests cover permission, track interruption, inference serialization and GPU/CPU adapter output.
- Capability/share tests reject manage URLs and temporary CDN fields.
- Run lint, type-check, all tests, production build, and desktop/mobile visual smoke checks.

### 7. Wrong vs Correct

#### Wrong

```ts
const opened = await post('/api/challenges/open', { challengeToken });
await demo.selectBilibili(`https://www.bilibili.com/video/${opened.challenge.video.bvid}`);
```

This discards the refreshed media/danmaku contract and can call a nonexistent legacy route.

#### Correct

```ts
const opened = await post<Opened>('/api/challenges/open', { challengeToken });
demo.selectResolvedBilibili(opened.playback);
```
