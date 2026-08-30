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

interface ScorePoint {
  timeSeconds: number;
  score: number; // integer 0..100; higher means harder to hold
}
```

Recipient phases are reducer-owned and include preparation/calibration, `running`, face-loss grace/pause/recovery/countdown, buffering, invalid, failed, and completed states.

### 3. Contracts

- Request camera permission only from the explicit acceptance button.
- Camera frames, landmarks, blendshapes, raw per-frame scores, and calibration samples remain local. Completion may additionally submit at most 600 downsampled `{ timeSeconds, score }` points; never submit reconstructable face data.
- Record trace points only while the challenge is actually running (including playing `face-grace`), never while paused, buffering, stabilizing or counting down. Freeze the final trace inside the immutable local result so completion retry sends identical points.
- Call `/api/challenges/open` once, then pass its `PlaybackData` to `selectResolvedBilibili`. Do not call the migrated demo `/api/parse` path again.
- Map `media[0]` to the player primary URL and keep every entry as a fallback candidate; preserve `danmakuUrl`.
- Before consent, show the signed stable cover/title/description/duration plus privacy disclosure.
- The complete recipient sequence—consent, calibration, ready, active, submitting and settlement—stays in one `ChallengeView`, one `/c/<token>` URL and one React page lifetime. Derive the visible stage from the reducer phase plus boundary state; do not navigate, reload or duplicate the gameplay state machine.
- Calibration does not require or mount an interactive player. The ready stage may mount ArtPlayer to become media-ready, but its host must remain `inert`, `aria-disabled` and pointer-locked until the reducer enters an active challenge phase.
- Claim the one-time attempt only from the explicit ready-stage start gesture. Camera/model/calibration failures never call `/api/challenges/start`.
- When a local result exists, close the camera and show an in-page submitting state. A failed completion request retains the same attempt token and immutable local result; retry sends the identical completion payload, and successful completion clears the attempt before rendering settlement in the same component tree.
- Store the attempt bearer only in per-tab `sessionStorage`, never in URLs, images, D1, analytics, or logs.
- After completion succeeds, persist a sanitized settlement snapshot under a challenge-token-scoped `sessionStorage` key so a same-tab refresh can restore the curve, heatmap and report link. On reload, apply that snapshot only after `/api/challenges/open` confirms `session.state === 'completed'` and its `result_expires_at` is still current; malformed, expired, missing or server-incomplete snapshots must be cleared and must not bypass the one-time challenge conflict state.
- During active playback, provide an immersive fixed player, top-left status, top-right circular local camera bubble, and centered face-loss/recovery messaging.
- Treat MediaPipe task creation as a serialized browser-global operation. Try the automatically selected WASM fileset with GPU then CPU; if both fail, retry the bundled `vision_wasm_nosimd_internal` fileset with GPU then CPU. A rejected initialization must not poison later retries.
- React effect cleanup must not close a detector still awaited by a newer StrictMode/retry consumer. Close a shared pending result only after its final consumer releases it.
- Detector initialization errors shown in the UI must remain collapsed behind the friendly recovery message and be length-bounded; redact URLs, local paths, bearer values and token/key/secret assignments before logging or rendering them.
- Share cards accept only public challenge/report URLs, render the video cover with `crossOrigin='anonymous'` and `referrerPolicy='no-referrer'`, and degrade to a branded placeholder.
- All thresholds and timeouts come from `src/shared/config/client.ts`; no component owns private copies.
- The `/` homepage keeps Composer and permanent leaderboard as two accessible state-switched panels. Tab changes preserve Composer state and do not change URL; only entering a real self challenge uses SPA `pushState` to `/c/<token>`.
- Score charts use “难绷程度” for the existing signal because higher values approach failure. A held result draws its terminal marker at video duration rather than relabeling the last valid sample as the endpoint.

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
| Completion retry after a network error | reuse the same frozen score trace; never resample or mutate the payload |
| Settlement refresh | restore only the validated same-tab snapshot after the server reports a current completed session; otherwise show the existing completed/expired state |
| Trace has no valid points | show a truthful empty chart state; do not synthesize a line |
| Homepage tab changes | keep Composer fields/parsed video mounted, hide the inactive panel from assistive technology, and keep `/` unchanged |
| Leaderboard self/share action | re-resolve the stable BVID through the Worker; never reuse cached media URLs |
| Settlement forward action | intercept the `转发此挑战` anchor, store only the stable BVID URL in `sessionStorage.forward-video`, push `/` with `history.pushState` and dispatch `popstate`; Composer consumes the value once and automatically calls `/api/bilibili/parse` |
| Forwarded parse fails | keep the URL in the input and surface the normal parse error so the user can retry manually; clear `forward-video` only after a successful parse |

### 5. Good/Base/Bad Cases

- Good: open returns media/danmaku → consent → isolated local calibration → inert ready player → explicit claim/start → one retry-safe result plus bounded trace → in-page chart/settlement; public report/private management remain separated.
- Base: cover or danmaku fails independently; core video challenge continues with clear fallback.
- Bad: calling an old parser after open, requesting camera on mount, uploading raw frame metrics, calling a rising failure signal “more able to hold”, or embedding a manage URL in a QR.

### 6. Tests Required

- Reducer/scoring/calibration tests cover danger recovery, sustained failure, face loss, buffering and invalid media events.
- `ChallengeView` test asserts open playback is passed directly to `selectResolvedBilibili`, video context is visible before consent, and no second parse request occurs.
- Recipient-flow tests assert only one stage is primary at a time, calibration does not mount the player, the ready player is inert, start is claimed only by the explicit button, pathname/history stay untouched through settlement, and failed submission retries the identical attempt/result before clearing session storage on success.
- Challenge refresh tests assert a successful completion writes a token-scoped snapshot, a current completed session restores settlement without a second completion request, and opened/expired/malformed snapshots are cleared.
- Player tests cover play authorization, progress/gesture locking, media fallback and cleanup.
- Camera/detector tests cover permission, track interruption, inference serialization and GPU/CPU adapter output.
- MediaPipe adapter tests assert the exact automatic GPU → automatic CPU → no-SIMD GPU → no-SIMD CPU order, queue recovery after rejection, and sanitized error output.
- Detector hook tests cover StrictMode/pending-request reuse, no premature close, final close exactly once, and a fresh initialization after a completed failure.
- Trace tests cover dynamic bucketing, the 600-point cap, valid challenge phases, reset/restart isolation, deep immutability and identical retry payloads.
- Chart tests cover empty/one/constant/long traces, danger/failure references, real held endpoint semantics, keyboard/touch labels and reduced motion.
- Home tests cover lazy leaderboard loading, loading/empty/error retry, preserved Composer state, inaccessible hidden panels, keyboard tabs, self/share actions and pushState/popstate without reload.
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

Do not store every inference result or mutate the trace on retry:

```ts
samples.push({ ...frameMetrics });
await complete({ scoreTrace: samples }); // raw, unbounded and retry-unstable
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

Capture a bounded projection and freeze it with the local result:

```ts
const scoreTrace = freezeScoreTrace(downsample(validRunningSamples, 600));
const result = Object.freeze({ ...settlement, scoreTrace });
```

Restore a completed result only after the server confirms the one-time session is still completed and within its result lifetime:

```ts
// Wrong: trust a client-only snapshot before checking the session state.
setCompleted(JSON.parse(sessionStorage.getItem(key)!));

// Correct: gate the snapshot with the server state and expiry, then validate
// score points/stats before rendering it.
if (opened.session?.state === 'completed' && isCurrent(opened.session.result_expires_at)) {
  setCompleted(readValidatedSnapshot(key, opened.challenge.video.duration));
} else {
  sessionStorage.removeItem(key);
}
```

Forward a settlement challenge through the existing SPA state instead of leaving a pasted URL that requires a second gesture:

```tsx
// Wrong: navigate/reload with only a prefilled input value.
<a href="/" onClick={() => sessionStorage.setItem('forward-video', url)}>转发此挑战</a>

// Correct: preserve the intent, update the SPA path, and let Composer consume
// the value once to call the existing parser automatically.
event.preventDefault();
sessionStorage.setItem('forward-video', url);
history.pushState({}, '', '/');
dispatchEvent(new PopStateEvent('popstate'));
```

## Scenario: Private result detail rendering

### 1. Scope / Trigger

- Trigger: changing `ManageView` or the `ManageResult` response fields used to restore a completed private result.
- Goal: the private entry is a truthful, refreshable settlement view with the same curve/heatmap language as the report, without exposing private challenge text or creating a second navigation flow.

### 2. Signatures

```ts
interface ManageResult {
  status: 'unopened' | 'opened' | 'started' | 'completed' | 'deleted' | 'expired';
  outcome?: 'held' | 'failed';
  elapsedSeconds?: number;
  expiresAt?: number;
  video?: VideoMetadata;
  stats?: AggregateStats;
  scoreTrace?: ScorePoint[];
}
```

`ManageView` calls `POST /api/manage/result` with the `bm1` token from the URL fragment, then reuses `ScoreTraceChart` and `Stats`; it must not call the public report resolver or re-run challenge playback.

### 3. Contracts

- Completed live results render the outcome/seconds, stable video title, “本次表情变化” chart, and anonymous aggregate/heatmap when those fields validate.
- A missing or malformed video/trace/stats field produces an explicit unavailable/empty state. The UI never invents a line, fake bar, or identity.
- Expired/deleted/non-completed statuses render status only; private detail disappears after expiry or destroy.
- The management token remains in the fragment and is sent only as an Authorization bearer; it is never rendered, copied into a share card, or put into a public URL.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Completed response with valid detail | Render chart and heatmap in the same private page |
| Completed response missing detail | Keep seconds/outcome and show a truthful unavailable message |
| Empty `scoreTrace` | Reuse chart empty state; do not draw a synthetic line |
| Expired/deleted response | Do not render chart, heatmap, title or private settlement detail |
| Manage request failure | Keep the page in place and show the normal error; do not navigate or retry automatically |

### 5. Good/Base/Bad Cases

- Good: click “刷新状态” → authorized completed payload → shared chart/stats components → destroy/expiry removes detail in place.
- Base: old rows show a summary plus explicit missing-detail copy.
- Bad: display only seconds when the backend has a trace, duplicate chart math in `ManageView`, or fall back to a client snapshot without the manage API response.

### 6. Tests Required

- `ManageView` tests assert completed trace/heatmap rendering, old-row degradation, and no detail for expired/deleted states.
- Shared chart tests continue to cover empty/one/long traces and accessible point labels; `Stats` tests cover empty and bucketed heatmaps.
- SPA tests assert the private route remains in place and no report/public navigation is introduced by refreshing or destroying the result.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Only seconds are shown even though the authorized response contains detail.
return <p>{result.elapsedSeconds} 秒</p>;
```

#### Correct

```tsx
return <>
  <SettlementSummary result={result} />
  <ScoreTraceChart points={result.scoreTrace ?? []} outcome={result.outcome!} durationSeconds={result.video!.duration} />
  <Stats stats={result.stats!} />
</>;
```

## Scenario: Friendly capability copy and full-page shell

### 1. Scope / Trigger

- Trigger: changing creator/settlement links, user-visible API errors, status/retention copy, or the product-shell background.
- Goal: ordinary users see concise, actionable language while capability values remain copyable and the homepage background covers short, long, and mobile viewports.

### 2. Signatures

```ts
interface CopyButtonProps {
  value: string;             // complete challenge/report/manage URL
  className?: string;
  label?: string;
}

function compactLink(value: string, privateLink?: boolean): string;
async function apiRequest<T>(path: string, options?: RequestInit): Promise<T>;
```

### 3. Contracts

- `CopyButton` writes the complete `value` to the clipboard and changes its visible label to `已复制` or `复制失败，请重试`; it never leaves the complete capability token as visible or persistent page content. A compatibility input, when needed, is removed immediately after the copy attempt.
- `compactLink` is presentation-only. It may show a short public suffix, but a private manage URL is always rendered as a redacted placeholder. Share-card and API payload values remain unchanged.
- User-facing copy must describe the action or outcome (`请先打开分享短链，再复制 B 站视频页面地址。`) rather than implementation details such as HTTP status, parser endpoints, token fragments, D1 buckets, or server configuration. Technical detector details remain behind a collapsed disclosure.
- `apiRequest` converts HTML/non-JSON responses into a safe retryable message and keeps structured API error messages when the response envelope is valid.
- `html`, `body`, `#root`, and page shells provide a minimum viewport height; the product gradient is applied to `#root` so it does not stop at the first short content block.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Long public or private capability URL | Render only a compact/redacted preview; copy the exact original value |
| Clipboard succeeds | Show `已复制` feedback on the same control |
| Clipboard API unavailable/rejected | Try a transient compatibility copy; if it is also rejected, show `复制失败，请重试` without exposing the URL |
| HTML or malformed API response | Show `服务暂时无法响应，请稍后重试。`; never show a JSON parser exception |
| Unsupported Bilibili URL/short link | Give an actionable B 站 page-address instruction without endpoint/HTTP jargon |
| Missing/deleted manage row | Show `尚未打开或已销毁` and no private detail |
| Short homepage content or tall mobile content | Keep the background continuous through the full viewport and document height |

### 5. Good/Base/Bad Cases

- Good: a `LinkBox` renders `.../c/…1234`, `CopyButton` copies the full signed URL, and a rejected clipboard operation is visible immediately.
- Base: an old private result has seconds but no detail; show the seconds and a friendly unavailable message without inventing a chart.
- Bad: rendering `bm1...` in a `<code>` block, calling `navigator.clipboard.writeText` with no feedback, showing `Unexpected token '<'`, or placing the gradient only on a content-sized child.

### 6. Tests Required

- `CopyButton` tests assert exact clipboard input and success/failure labels.
- `compactLink` tests assert public compaction, private redaction, and no mutation of the copied value.
- API client tests assert HTML/non-JSON responses become the friendly retry message.
- Composer/settlement/manage tests assert compact links, status wording, and no private detail after deletion/expiry.
- Home tests assert the leaderboard tab remains state-switched and the permanent/long-term label stays visible.
- Run lint, type-check, all tests, production build, and `wrangler deploy --dry-run` after shell or Worker-copy changes.

### 7. Wrong vs Correct

#### Wrong

```tsx
<code>{manageUrl}</code>
<button onClick={() => void navigator.clipboard.writeText(manageUrl)}>复制</button>
// A failed fetch bubbles `Unexpected token '<'` into the page.
```

#### Correct

```tsx
<code>{compactLink(manageUrl, true)}</code>
<CopyButton value={manageUrl} label="复制链接" />
// apiRequest catches a non-JSON response and throws a retryable Chinese message.
```
