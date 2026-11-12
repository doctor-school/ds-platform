# 044 registration windows and name cleanup

Exactly three original API clauses, selected by `@congress-window-names`, run
with `bddgen --config congress-originals.config.ts` and
`playwright test --config congress-originals.config.ts` from `packages/e2e`.
Run `tsx api-probes/assert-congress-report.ts <results.json> <backgrounds.jsonl>`
afterwards. It requires three unique passing cases, zero skips/retries/errors,
and eighteen ordered Background receipts emitted only after assertions.

Set `DATABASE_URL`, `E2E_CONGRESS_DATABASE=ds_dev_3974`, `E2E_CONGRESS_DIR`
(a fresh absolute temporary directory), `E2E_CONGRESS_REPORT`, and
`E2E_CONGRESS_NGINX` (an absolute path to an actual task-scoped nginx binary).
The existing `api-e2e` CI lane uses its disposable `ds_test`. Build the API and
its dependencies first. Locally create a fresh branch DB through the supported
`dev:db:branch 3974`; after an earlier run, preserve its manifests and obtain
cleanup acceptance before `dev:db:drop 3974` and recreation. Never reset the
shared stand. Literal `names@example.org` must be absent before the names case.

The fixture uses compiled AppModule/controller/service, real Postgres, the
owning nginx location and production trust resolver, and an injected owning
clock. Only external IdP and mail transport use their native fakes. The native
bot guard stays installed with its documented disabled local setting; public,
bot and rate metadata are asserted. With `REDIS_URL` absent, the native memory
rate/handoff adapters are used. Every case drives sixty invalid requests and
the sixty-first 429 on a separate actual client address, checking the 900-second
window and unchanged complete account/registration/consent snapshots and mail
counts. This is no Redis, identity-provider, captcha-provider or auth acceptance.

`owning-nginx.conf` and `privacy-policy.txt` retain exact pinned external source
bytes. `privacy.html.capture` is the live HTTP200 `/privacy/` capture from 2026-11-11;
every paragraph matches the canonical policy. `provenance.json` pins their
hashes, source commit and the accepted launch evidence for publication date
2026-09-23. The owned nginx publishes these unchanged page bytes locally.
Only the environment server envelope/listen/static root and upstream address
(including upstream-specific TLS settings for local HTTP) are adapted; exact
original/adapted locations and config hashes are retained per case.

Before closing each fixture, `resources.json` records its exact actor IDs,
event, native rate keys, hashed handoff keys and empty cookies/forms/nonces.
All PG/HTTP/process operations are prelogged in `stand-ops.jsonl`. The test
closes its own AppModule and nginx; records remain in the owned DB until the
lead accepts cleanup. Retain the native congress suites: this contour does not
replace their broader contracts. No visual artifact or product change.
