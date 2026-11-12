# Material reading originals (048)

This contour runs the unchanged spec-owned definitions tagged
`@material-reading-pages`: retry after a failed read, a private draft's 404, the
absence of Academy materials on Doctor, and the seven Academy-home rail
scenarios (EARS-14/15/16: paging, keyboard, no auto-motion, a failed next page,
first-page placeholders, the empty feed, a failed first read). The inherited
published-expert Background runs in every scenario. The source remains
`apps/docs/content/specs/features/048-materials-feed/048-scenarios.feature`.

The rail reads `GET /v1/public/feed` in the browser. The production portal
build bakes its `/v1/*` rewrite target before the runtime picks the transport's
port, so the `page` fixture carries the browser's same-origin `/v1/*` reads to
the owned transport (real API bytes). «Fails once» is one browser `503` on the
first matching feed read; «slow to answer» holds that read and then forwards it
unchanged.

The contour owns a compiled real API, two production-built Next storefronts and
one migrated task database. A loopback pass-through transport fails exactly one
named material read with 503; all subsequent responses come from the real API
and Postgres. This reaches the Academy's **server-side** fetch and the real
«Повторить» handler. Browser `route.fulfill` would not reach that fetch.
Successful article or 404 responses are never fabricated.

Like the operational API originals, these steps have an explicit separate
config. They are outside the default remote-stage step glob: a test may not
interrupt a shared slot's API or add a public fault hook. The remote-stage suite
keeps its existing unbound scenarios visible. Passing this contour proves these
originals on its owned runtime, not a green whole-stage suite or the phone,
preview, authoring and remaining article acceptance owned by #3517.

From the repository root, build and provision first:

```sh
pnpm exec turbo run build --filter=@ds/api --filter=@ds/portal --filter=@ds/doctor
pnpm dev:db:branch 3702
```

Privately export the resulting branch URL as `E2E_MATERIAL_DATABASE_URL`; shared
or other-task database names are refused. CI uses its own `ds_probe_3702` DB.
Set `E2E_MATERIAL_ARTIFACT_DIR` to your scratch directory and `E2E_REPORT_DIR` to
its report subdirectory. Then run:

```sh
pnpm --filter @ds/e2e exec bddgen --config material-pages.config.ts
pnpm --filter @ds/e2e exec playwright test --config material-pages.config.ts
pnpm --filter @ds/e2e exec tsx material-pages/assert-report.ts "$E2E_REPORT_DIR/results.json"
```

Missing builds or prerequisites fail by name; this contour has no skip path and
zero retries. The report assertion requires each canonical title exactly once,
all passed, with no skipped, retried or flaky test. JSON/HTML, browser captures,
the injected/forwarded request receipts, process logs and `stand-ops-3702.log`
stay in that scratch directory. The fixture closes only its own processes and
loopback transport, proves their ports released, and deletes only its exact
seeded row ids. After final proof, drop the owned branch DB with
`pnpm dev:db:drop 3702`; do not reset or roll back the shared stand.

`.github/workflows/material-pages.yml` builds and runs this same contour against
an ephemeral migrated Postgres on the PR head, and uploads its evidence. No
authentication journey, UI implementation or production deployment is added.
