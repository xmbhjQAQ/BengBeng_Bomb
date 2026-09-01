# Web Share API research

## Source

Context7 lookup of MDN Web Docs (`/mdn/content`) on 2026-09-01:

- `navigator.canShare(data)` returns whether the specific data shape (including `files`) can be shared. It is the recommended check before file sharing.
- `navigator.share(data)` invokes the native share mechanism and must be triggered by user activation. Its promise rejects for cancellation or other failures.
- File sharing examples pass `{ files }` and do not assume that a browser can share every file type.

## Application implications

- Desktop browsers without a native Web Share implementation must use an in-page fallback; this is expected capability variance rather than a server failure.
- The client should not require `canShare` when `share` exists, because an absent capability probe can be handled by attempting the user-activated call and catching the result.
- The existing pre-generated `File` is appropriate for preserving user activation at click time. Fallback feedback must remain visible and actionable.
- Clipboard image writing is an optional enhancement and must be treated as best-effort; copying share text and downloading the already-rendered PNG remain the reliable fallbacks.
