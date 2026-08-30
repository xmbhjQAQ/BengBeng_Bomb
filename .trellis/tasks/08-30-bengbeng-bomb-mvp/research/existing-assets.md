# Existing Asset Reuse Research

## Scope inspected

- `模块化开发及技术验证成果/B站视频+笑脸检测验证`
- `模块化开发及技术验证成果/B站链接解析与播放器及封面获取思路及实践`
- `模块化开发及技术验证成果/B站外链解析后端`
- `模块化开发及技术验证成果/smile-detection-demo`
- `已有后端/API调用方法.md`
- the endpoint/Key note was inspected only in redacted form; no credential is copied here

## Integrated gameplay baseline

The strongest starting point is `B站视频+笑脸检测验证`, a React 19 + TypeScript + Vite application already integrating:

- MediaPipe Tasks Vision Face Landmarker with vendored model/WASM assets and GPU-to-CPU fallback;
- camera lifecycle and an inference loop;
- median neutral baseline calibration with sample-count and stability checks;
- a smile signal using mouth-smile, cheek-squint, mouth shape and jaw-open features;
- baseline-normalized scoring, exponential smoothing, danger/failure/release thresholds and a sustained-duration failure rule;
- a reducer-owned challenge transition table for normal playback, face-loss grace, paused recovery, countdown, buffering, failure, completion and invalidation;
- Bilibili direct-link parsing, cover/media fallback, ArtPlayer danmaku integration, playback authorization and progress interaction locking;
- tests for the core adapters, reducers, hooks and result builder.

Existing tuning defaults are a good starting point but must move to the product configuration owner. The demo contains a browser-visible API Key in its config; that value must not be migrated. The product client calls only the same-origin Worker API.

## Bilibili integration evidence

The bilidirect contract supports:

- `GET|POST /api/parse` with BVID, page, quality and optional probe;
- stable metadata including BVID/AID/CID/page/title/duration/cover and temporary `directUrl`/fallback playback data;
- `GET /api/danmaku` returning XML with browser-compatible headers;
- `GET /api/health`;
- `X-API-Key` authentication and configured allowed origins.

Important constraints:

- playback URLs expire and must be resolved close to playback time;
- the browser should load video directly from Bilibili CDN and use `no-referrer` media behavior;
- cover images can fail with `RefererWhite`; a real `<img>` must set `referrerPolicy='no-referrer'` before `src`;
- ArtPlayer poster uses CSS background behavior and is not a reliable cover solution;
- danmaku can be proxied, but video content must not be;
- direct `bilibili.com/video/BV...` URLs are verified; b23.tv and QQ share links require a separate redirect resolver and currently need an explicit unsupported message;
- reloading a player requires cancellation/request sequencing and full instance/listener cleanup.

## Migration guidance

Copy/adapt the verified source into the new product tree, preserving focused modules and tests. Do not import from or resolve assets through either reference directory. Copy the MediaPipe assets and third-party notices into product `public/vendor` and verify the final dependency graph remains valid when reference paths are excluded.

## Privacy/security observations

- Camera frames and observations are already local-only; retain this boundary.
- Only a single final challenge result should cross the network.
- The upstream endpoint is a non-secret Worker variable; its Key is a Worker Secret.
- Never forward an upstream-generated danmaku URL that embeds a Key. Expose a same-origin ticketed route instead.

