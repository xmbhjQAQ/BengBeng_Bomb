# Static Security Header Guidelines

## Scenario: CSP allowlist for approved analytics

### 1. Scope / Trigger

- Trigger: changes to `secureAsset`, static asset response headers, Clarity, Cloudflare Pages Web Analytics, or any third-party script in the deployed HTML.
- Goal: keep the static page CSP restrictive while allowing the approved analytics bootstraps.

### 2. Signatures

```ts
function secureAsset(response: Response): Response;
```

The static header contains a `script-src` directive with first-party sources, the exact Clarity bootstrap hash, and explicit approved hosts.

### 3. Contracts

- `secureAsset` always sets `Content-Security-Policy`; API response helpers do not receive third-party script exceptions.
- The unchanged Clarity inline bootstrap in `index.html` is authorized by its exact SHA-256 source hash. Do not add global `script-src 'unsafe-inline'`.
- `script-src` explicitly permits `https://www.clarity.ms`, `https://scripts.clarity.ms`, and `https://static.cloudflareinsights.com`.
- Existing `img-src 'self' https: data: blob:` and `connect-src 'self' https:` cover documented Clarity collection endpoints.
- Analytics is optional: blocked or unavailable analytics must not affect React boot, camera permissions, API calls, media playback, or SPA routing.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Official Clarity bootstrap bytes unchanged | CSP hash permits execution and the tag request can start |
| Clarity loader or Pages Insights host requested | Script source is allowed by the explicit host list |
| Unapproved inline script | Remains blocked; no `unsafe-inline` fallback |
| Analytics endpoint unavailable | Site remains usable; no unhandled application error |
| CSP applied to an API response | API keeps normal JSON security headers; static policy is not widened |

### 5. Good / Base / Bad Cases

- Good: the deployed HTML keeps the exact Clarity snippet, both analytics scripts can load, and analytics failure does not break the app.
- Base: a privacy extension blocks analytics; the app still renders and only analytics requests are absent.
- Bad: remove CSP, add `script-src 'unsafe-inline'`, allow `https:` as a script source, or put analytics credentials in application state.

### 6. Tests Required

- HTTP security tests assert the exact Clarity hash, all three approved script hosts, restrictive directives, and absence of `unsafe-inline` in `script-src`.
- Asset smoke/deployment checks inspect built HTML for the matching bootstrap bytes so a formatting edit cannot silently invalidate the hash.
- Run Worker tests, lint, type-check, production build, and `wrangler deploy --dry-run` after security-header changes.

### 7. Wrong vs Correct

#### Wrong

```ts
const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' https:";
```

#### Correct

```ts
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'sha256-<exact-index-hash>' https://www.clarity.ms https://scripts.clarity.ms https://static.cloudflareinsights.com",
].join('; ');
```
