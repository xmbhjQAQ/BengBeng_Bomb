# bilidirect main branch short-link contract

## Source

- Repository: `https://github.com/xmbhjQAQ/bilidirect`
- Branch: `main`
- Inspected commit: `2a2110a74b1fc990138ad77cd401e7344125b25d` (`Support Bilibili short links only`)

## Confirmed API behavior

- `GET /api/parse` and `POST /api/parse` accept either `bvid` or `url`.
- When both are present, `url` takes precedence.
- `url` supports standard Bilibili video pages and `b23.tv` short links. The service follows up to four Bilibili redirects and extracts the final BV identifier server-side; the client does not need to resolve the redirect.
- Standard video URL query parameters are ignored by the upstream resolver.
- Successful responses expose `data.source` with `input`, `resolvedUrl`, and `type`, alongside the existing stable metadata/media fields.
- The upstream service still returns temporary CDN URLs and the existing danmaku fields; no change is needed to the challenge capability or playback projection.

## Current project gap

- `src/worker/index.ts` calls `parseDirectBvid` and therefore rejects `b23.tv` before the upstream is contacted.
- `src/worker/bilibili/adapter.ts` always sends `{ bvid, ... }` to bilidirect, so it has no request shape for a short URL.
- `src/client/gameplay/bilibili/bilibili.ts` also labels `b23.tv` as unsupported in the legacy/direct-player path.
- User-facing copy in `ComposerView`, README, and active frontend/backend specs still tells users to open a short link and copy the long Bilibili page.

## Compatibility and safety constraints

- Keep the Worker as the only holder of `BILIDIRECT_API_KEY`; the browser must never receive or send that key to the upstream directly.
- Validate the supplied URL against the supported Bilibili hosts or `b23.tv` before forwarding it. Do not turn the new `url` field into an arbitrary fetch proxy.
- Keep challenge payloads and `PlaybackData` stable: persist only the canonical BV metadata and sanitized media candidates after parsing. `data.source` is diagnostic metadata and must not enter signed capabilities.
- Preserve exact-BV and standard Bilibili URL behavior, retry/timeout/body-limit behavior, and the one-request `POST /api/challenges/open` flow.
- QQ share URLs and other short-link domains remain unsupported because the referenced backend contract currently supports only Bilibili pages and `b23.tv`.
