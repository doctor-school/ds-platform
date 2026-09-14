# `@ds/e2e` — the C6 regression contract

The end-to-end regression contract of the staging/regression-contour tech spec
([`2026-09-08-staging-previews-and-regression-contour-en.md`](../../apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md)
§6, Issue #2067): **one** step package shared by both storefronts, the spec's own
feature files as the suite, and the navigation model both headers render from.

## What is in here

| File                   | What it is                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation-model.ts`  | The model TYPE (`NavigationItem`, `NavigationModel`, `Audience`) plus the pure projections `itemsFor` / `landingEvidence` / `byId`.                                                                  |
| `hosts.ts`             | The `HostConfig` registry: one entry per storefront (`academy` = `apps/portal`, `doctor` = `apps/doctor`) with its base-URL env var, its login surface, and the PATH of its navigation-model module. |
| `route-params.ts`      | Dynamic-segment resolution for the route walk (§6.3): route pattern → the golden entity that renders it, keyed per host.                                                                             |
| `derived/`             | The two derived walks (§6.3): `navigation.walk.spec.ts` and `routes.walk.spec.ts`. Plain Playwright specs, run by the `walks` project.                                                               |
| `steps/`               | The shared Gherkin vocabulary: `support/fixtures.ts` (the `host` fixture), `golden.steps.ts`, `navigation.steps.ts`.                                                                                 |
| `lib/`                 | The pure, unit-tested seams (`golden.ts`: seed name → `@ds/db` golden account; `routes.ts`: route-manifest → visitable addresses) plus `sign-in.ts`, the package's one login path.                   |
| `playwright.config.ts` | `bddgen` over the spec feature files + the two host projects + the `walks` project.                                                                                                                  |

## Running it

The suite drives a RAISED slot; it starts nothing itself (the slot topology
belongs to `tools/staging`, never to a test config).

```sh
E2E_PORTAL_URL=https://pr-123.stage.doctor.school \
E2E_DOCTOR_URL=https://d-pr-123.stage.doctor.school \
DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED=… \
pnpm --filter @ds/e2e test:e2e            # bddgen && playwright test
```

`pnpm --filter @ds/e2e bddgen` alone regenerates the runnable specs; `pnpm
--filter @ds/e2e test` runs only the pure unit seams (no browser, no slot).
An unset `E2E_*_URL` fails by NAME — a run that silently defaulted to localhost
would report a green pass against nothing.

## The suite is the spec's feature file

`features` points at `apps/docs/content/specs/features/*/*-scenarios.feature`
(§6.1). There is no second copy of a scenario in a test folder: a scenario cannot
exist without the requirement it verifies, and `author-ears-spec` step 7 already
produces the file for every new feature.

### Host tags

Every spec feature file declares, once at Feature level, which storefront runs
it: `@host:academy`, `@host:doctor`, `@host:both`, or `@host:admin`. The
projects select **positively** — `@host:academy or @host:both` on academy,
`@host:doctor or @host:both` on doctor (`lib/host-tags.ts` builds both
expressions, so the vocabulary and the selection can never drift apart).

`@host:admin` is selected by no storefront project on purpose. An admin-surface
journey (007, 011, 012) or a backend-only one (010) belongs to the admin suite in
`apps/admin`; running it against a storefront reports a false red, which is the
one thing this suite must not teach the team to ignore. A pure API spec (001, 002) drives its checks through ONE storefront's API proxy and is tagged
`@host:academy` — never `@host:both`, which would pay double runtime for one API.

Positive selection is what makes the tag structural: an untagged file is selected
by NEITHER project, so its scenarios silently stop existing. The `bddgen` script
therefore runs `bin/check-host-tags.ts` first — it exits 1 naming every feature
file that carries no Feature-level host tag, or more than one, so generation
fails loudly instead of quietly shrinking the suite.

Adding or retargeting a host tag is a suite-selection edit, not scenario
authorship: `tools/lint/lib/diff.ts` keeps such a file OUT of the §6.4/§6.5
«touched» set, so annotating a spec does not make the annotating PR inherit that
spec's §8 backfill debt. Change one scenario line in the same file and it counts
as touched again.

## Missing-step policy: `skip-scenario`

Most spec feature files still carry the pre-contract step prose the §8 backfill
rewords, so most scenarios have no matching step definition yet. Of the three
policies `playwright-bdd` 9.2 offers:

- `fail-on-gen` would make `bddgen` exit non-zero permanently — a gate nobody can
  keep green teaches the team to skip it;
- `fail-on-run` would report those scenarios as FAILURES, making a red suite the
  normal state and destroying the signal of a real regression;
- **`skip-scenario`** keeps generation green _and_ lists every unimplemented
  scenario in the run output as skipped — visible and countable, never silently
  dropped. That is what lets the §6.4 coverage lint tell «not written yet» from
  «gone».

`retries: 0` (§6.5): a retry turns a flake into a pass and a regression into a
slow pass.

## The navigation-model contract

Each storefront exports its navigation as DATA from a React-free module next to
the header that renders it:

- `apps/portal/lib/navigation-model.ts` → `portalNavigationModel`
- `apps/doctor/lib/navigation-model.ts` → `doctorNavigationModel`

The header renders **from** that array — `apps/portal` resolves `label` as a
`shell` message key, `apps/doctor` renders it as the Russian literal it already
carried — and the derived navigation walk reads the same array. A new header link
therefore enters the regression suite with zero edits to any list, and the model
cannot drift from what the bar paints.

Each item carries the §6.2 landing evidence: the `h1` the destination actually
renders, or a `data-surface` marker for a page that owns none. Asserting the
address alone is what let «200 on the wrong page» (#2012) stay green.

**Why the model is registered by PATH, not imported.**
`local/package-import-boundary` forbids any `packages/**` module from reaching
into `apps/**`, so `@ds/e2e` cannot import a host's model. `hosts.ts` records the
module path and `loadNavigationModel()` resolves it against the repo root with a
dynamic import at run time. The boundary stays intact and the walk still reads
the host's own single list. The type travels the other way, which is allowed and
is how a host pins its model to the contract: `import type { NavigationModel }
from "@ds/e2e/navigation-model"` + `satisfies`.

## Derived walks

Two specs under `derived/`, both of which contain **no list of destinations** —
they read the host's own artifacts, which is what «ten new links in a release
enter both walks with zero edits to any list» (§6.3) means in practice.

**`navigation.walk.spec.ts`** loads each host's navigation model and visits every
item twice: as a guest (`itemsFor(model, "guest")`) and as the golden signed-in
doctor. Per item it asserts status 200, the pathname, and the item's declared
landing evidence. A guest item that redirects to the host's login surface instead
asserts the login `h1` and that `returnTo` still carries the original href — a
redirect that loses `returnTo` strands the guest after sign-in.

**`routes.walk.spec.ts`** fetches the slot's own route manifest, filters it to
the addresses a visitor can type (`lib/routes.ts` — route handlers, `/api/**`,
`/_not-found`, `/_next/**`, parallel slots and intercepting routes are out; route
groups are stripped from the address), resolves dynamic segments through
`route-params.ts`, and asserts 200 + a non-empty `h1`. Three conditions are
FAILING tests rather than skips, each titled with what is missing: an
unconfigured base URL, a manifest the slot does not serve, and a dynamic route
with no `route-params.ts` entry.

`/documents/[slug]` is that last case today on both hosts: the golden catalogue
seeds no document row, so the walk fails naming the route — deliberately, because
`/documents/[slug]` is the exact route whose runtime files went missing from the
standalone image in #2012, and a silent skip would hide it again.

### The route manifest is published by the image

The walk reads `.next/server/app-paths-manifest.json`, which the standalone
bundle does not carry. Both `apps/portal/Dockerfile` and `apps/doctor/Dockerfile`
copy it out of the build stage into the runtime image's `public/` tree at

```
/__contour/app-paths-manifest.json
```

exported from `hosts.ts` as `MANIFEST_PATH` — one constant shared by the two
Dockerfiles, the walk and this README. Reading it from the SLOT rather than from
the repo is the whole point: the repo says what the source declares, the slot
says what the image actually serves.

Both hosts run inside ONE Playwright project (`walks`). The Gherkin projects are
per host because `bddgen` writes a different generated directory per host tag
filter; the walks have no such artifact — the host is data, read from `HOSTS`,
and each test title names the host it walked.

## Golden entities by seed name

`Given the golden doctor "verified-cardiologist" is signed in` (§6.1). A feature
file never carries an email or a password. `lib/golden.ts` is the one place a
seed name becomes a real `@ds/db` golden account plus the env var holding its IdP
password (`DS_GOLDEN_PASSWORD_DOCTOR_*` — the seed never invents a password). A
mistyped name fails loudly with the accepted names listed.

The sign-in adds no auth primitive: it drives the host's real login surface the
way the shipped 008 shell journey does (`apps/portal/e2e/steps/shell.steps.ts`).
It lives in `lib/sign-in.ts` and is the package's ONE login path — the Gherkin
step and the navigation walk's doctor pass both call it, so they cannot drift
into two different notions of «signed in».

## Running this suite against a staging slot

`pnpm --filter @ds/e2e test:e2e` runs whatever `E2E_PORTAL_URL` / `E2E_DOCTOR_URL` point
at. The supported way to point them at a converged staging slot is
[`pnpm e2e:stage <slot>`](../../tools/staging/README.md#regression-run-pnpm-e2estage-slot):
it derives both hostnames from the slot name, reads the stand's basic-auth pair (which this
config turns into Playwright `httpCredentials`), refuses a slot that is not converged,
keeps the HTML + JSON report under `packages/e2e/playwright-report/<slot>-<timestamp>/`,
and prints the verdict block the operator pastes into the PR body or the release record.
`--project walks` selects the derived walks alone (the two storefront a11y legs belong to
the host projects, so that selection runs neither).
