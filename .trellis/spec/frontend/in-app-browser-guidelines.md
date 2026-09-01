# Embedded Browser and Image Share Guidelines

## Scenario: Embedded-browser challenge recovery and route shell

### 1. Scope / Trigger

- Trigger: changes to challenge entry routing, QQ/WeChat handling, the shared home control, or native image sharing.
- Goal: keep camera challenges usable only in a system browser, preserve the single-page flow, and provide a safe image/text fallback when Web Share is unavailable.

### 2. Signatures

```ts
function detectInAppBrowser(userAgent?: string): {
  kind: 'wechat' | 'qq' | null;
  platform: 'android' | 'ios' | 'other';
};

function isCameraChallengePath(pathname: string): boolean;

function shareImageFile(
  file: File,
  shareText: string,
  environment?: BrowserEnvironment,
): Promise<'shared' | 'cancelled' | 'image-copied' | 'text-copied' | 'unavailable'>;
```

### 3. Contracts

- UA detection is a pure function and recognizes WeChat plus common QQ app/browser tokens, including Android/iOS variants; it must not infer from mutable UI state.
- The full-screen notice is rendered only for a valid `/c/<token>` or `/g/<token>` camera challenge route when the UA is QQ/WeChat. It explains the top-right “在浏览器中打开” action and recommends Edge/Via on Android or Safari on iOS. Other routes and ordinary browsers render normally.
- The notice is an accessible blocking surface (`role="alertdialog"`, `aria-modal="true"`, focus moved into it); the underlying challenge remains mounted so opening the link in a system browser is the only recovery action.
- Every non-home, non-camera-challenge view exposes a SPA “回到首页” control. It uses `history.pushState` and does not reload; camera challenge routes intentionally omit it.
- Native image sharing sends only `{ title, files }` and is attempted from the user action. If `canShare` exists, a false result falls back without calling `share`; if it is absent, attempt `share` directly. Cancellation must not copy anything.
- Fallback first tries clipboard image data, then copies the share text. The UI reports the exact result and leaves a manual “复制分享文案” action when text still needs to be copied. No fallback may navigate or expose private/management URLs.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| QQ/WeChat + `/c` or `/g` challenge | Show blocking notice; do not start camera flow |
| QQ/WeChat + report/group-results/entry/manage | No notice; show home control where applicable |
| Malformed or empty challenge token | Render invalid route with home control; no mask |
| Normal browser on challenge | No notice; preserve camera challenge UI |
| `navigator.share` + file support | Share image only, no URL/text payload |
| `canShare` false or native share failure | Try image clipboard, then text clipboard |
| User cancels native share (`AbortError`) | Return `cancelled`; do not touch clipboard |
| Clipboard APIs unavailable/fail | Return `unavailable`; keep download and manual-copy actions usable |

### 5. Good/Base/Bad Cases

- Good: a WeChat `/c/token` visit immediately gets the system-browser instructions; a report view uses the SPA home control; Edge without Web Share copies the image or gives a clear text-copy fallback.
- Base: QQ’s UA is a desktop-mode/iOS variant, or `canShare` is missing; classification and direct share attempt remain deterministic.
- Bad: render the mask on every route, redirect/reload to return home, include a result URL in the native share payload, or copy text after an explicit share cancellation.

### 6. Tests Required

- Pure classifier tests cover WeChat, QQ app/browser tokens, Android/iOS recommendations, ordinary browsers, malformed paths, and `/c`/`/g` matching.
- App integration tests cover mask visibility/removal, focus/ARIA attributes, route-scoped home control, and `pushState` navigation without reload.
- Share-helper tests cover files-only payloads, missing/false `canShare`, image/text clipboard fallback, receiver-preserving clipboard calls, cancellation, and total API failure.
- Existing challenge, group-entry/results, settlement, and share-card tests must remain green.

### 7. Wrong vs Correct

#### Wrong

```ts
navigator.share({ title, text: shareText, url: resultUrl });
window.location.href = '/';
```

#### Correct

```ts
const status = await shareImageFile(imageFile, shareText);
// App keeps one SPA route; HomeNavigation uses history.pushState.
```
