# Cloudflare Platform Research

## Source

Current Cloudflare Workers documentation was resolved through Context7 as `/websites/developers_cloudflare_workers` on 2026-08-30.

## Confirmed platform shape

- A Worker can serve a compiled SPA through an `ASSETS` binding and route missing paths with `not_found_handling: "single-page-application"`.
- `assets.run_worker_first` can route `/api/*` through the Worker before static asset handling.
- D1 databases are exposed through Wrangler bindings and migrations can be applied with `wrangler d1 migrations apply`.
- A module Worker can export both `fetch` and `scheduled` handlers; Cron Triggers can invoke the scheduled handler for expiry cleanup.
- Secrets/Secret Store bindings are separate from normal variables. Product TTL values and the upstream base URL are normal environment variables; signing and upstream API keys are secrets.

## Architectural conclusion

Use one Worker deployment for SPA assets and low-frequency APIs, one D1 database for opened/completed temporary sessions and anonymous aggregates, and a scheduled cleanup handler. Keep the existing bilidirect service replaceable behind a server-only adapter. This minimizes deployment parts and matches the Free-oriented requirement without putting video or face-computation load on Cloudflare.

## Implementation verification needed

- Confirm exact package versions and test-pool configuration with current docs when scaffolding.
- Run local D1 migrations and Worker integration tests.
- Run a Wrangler dry-run, but do not create/deploy production resources without user account authorization.

