# Implementation plan

1. Add a shared SPA “回到首页” control and focused route tests; render it for every non-challenge page without changing challenge URLs or adding reloads.
2. Add pure UA detection types/functions and focused unit tests for WeChat, QQ/QQBrowser, Android, iOS/iPadOS and ordinary browsers.
3. Add the in-app browser classifier/notice and responsive full-screen mask; wire it into `App` so only `/c/<token>` and `/g/<token>` challenge views are blocked without changing SPA navigation.
4. Add a tested file-share helper covering native file sharing, missing `canShare`, false capability, cancellation, image clipboard best effort, and text-copy fallback.
5. Refactor `ComposerView` to use the helper while preserving existing pre-generation, button states, manual copy control and download path.
6. Update component tests for the new feedback and ensure no URL/text is passed to native share.
7. Update the Worker CSP and `public/_headers` with a hash for the existing Clarity bootstrap and explicit Clarity/Cloudflare Insights script hosts; add a parity regression test.
8. Run `npm run lint -- --no-warn-ignored`, `npm run type-check`, `npm test -- --run`, `npm run build`, and `git diff --check`.

## Risk / rollback points

- UA matching should remain isolated and pure; if a vendor UA is over-matched, adjust the classifier without touching app routing.
- Clipboard image writing is optional; remove only that branch if a browser-specific regression appears. Text copy and PNG download must remain intact.
- Do not alter existing API or share-card renderer contracts.
