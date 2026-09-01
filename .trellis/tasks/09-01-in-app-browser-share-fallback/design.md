# Technical design

## Boundaries

- Add a shared `HomeNavigation` control in the `App` shell. It renders for non-home, non-challenge routes and uses the existing `navigate('/')` callback; challenge routes remain visually focused and do not render it.
- Add a small pure UA classifier under `src/client/app/` that accepts an explicit UA string for deterministic tests and returns `{ kind, platform }`.
- Add an `InAppBrowserNotice` component rendered by `App` around route-specific views. It reads the classifier once per render, uses `role="alertdialog"` with an inert/aria-hidden route layer, and renders a full-screen blocking mask only for QQ/WeChat-like UAs on `/c/<token>` and `/g/<token>` challenge routes.
- Extract file-share capability and fallback orchestration from `ComposerView` into a client helper so the component only maps outcomes to feedback state. The helper receives the already-generated PNG `File`, title, share copy, and browser globals as optional dependencies for tests.

## Share outcome flow

1. If `navigator.share` is absent, return an unsupported outcome.
2. If `navigator.canShare` exists and safely returns false for the PNG, return unsupported without invoking native share.
3. Otherwise invoke `navigator.share({ title, files })` immediately from the click handler. Never include `url` or `text`.
4. Map `AbortError` to `cancelled` and all other rejections to `failed`.
5. For `failed`/`unsupported`, best-effort write the PNG with `ClipboardItem` when available. If image clipboard succeeds, return `image-copied`; if not, copy the share copy and return `text-copied` or `fallback-unavailable`.
6. The component always exposes a manual `CopyButton` after an unsupported/failed attempt and leaves the download action available.

## Notice behavior

- Detection is client-only and has no network side effects.
- WeChat and QQ matches are normalized case-insensitively; platform checks recognize Android and iOS/iPadOS UA tokens.
- The notice is a full-screen blocking mask on camera-bearing challenge routes. It does not render on home, group entry, results, report or management routes, so those pages remain usable for link copying and result viewing.

## Compatibility and privacy

- No server/API changes and no new persistence.
- The UA is only used locally to choose copy; it is not sent to the Worker or analytics code.
- Native share remains image-only, preserving the existing public-link and private-token boundaries.
