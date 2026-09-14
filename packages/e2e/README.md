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
| `route-params.ts`      | Dynamic-segment resolution for the route walk (§6.3) — empty until the walk lands.                                                                                                                   |
| `steps/`               | The shared Gherkin vocabulary: `support/fixtures.ts` (the `host` fixture), `golden.steps.ts`, `navigation.steps.ts`.                                                                                 |
| `lib/`                 | The pure, unit-tested seams (`golden.ts`: seed name → `@ds/db` golden account).                                                                                                                      |
| `playwright.config.ts` | `bddgen` over the spec feature files + the two host projects.                                                                                                                                        |

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

Host selection is by tag. §6.1 tags scenarios `@host:academy` / `@host:doctor` /
`@host:both`; the projects use the exact complement — `not @host:doctor` on
academy, `not @host:academy` on doctor. A scenario tagged for one host is
excluded from the other, `@host:both` runs on both, and a scenario **not yet
tagged** runs on both rather than on neither. That last case is today's reality:
the 18 spec feature files predate this contract, and a stricter expression would
leave a suite that silently runs nothing until the §8 backfill (#2068).

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

## Golden entities by seed name

`Given the golden doctor "verified-cardiologist" is signed in` (§6.1). A feature
file never carries an email or a password. `lib/golden.ts` is the one place a
seed name becomes a real `@ds/db` golden account plus the env var holding its IdP
password (`DS_GOLDEN_PASSWORD_DOCTOR_*` — the seed never invents a password). A
mistyped name fails loudly with the accepted names listed.

The sign-in adds no auth primitive: it drives the host's real login surface the
way the shipped 008 shell journey does (`apps/portal/e2e/steps/shell.steps.ts`).
