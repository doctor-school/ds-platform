# `@ds/storefront-shell`

The storefront chrome — header and footer — owned **once** for both storefronts:
`doctor.school` and `academy.doctor.school`.

Canonical cross-front capability per ADR-0013 A1 and epic #2020 «one code, two
storefronts»: before this package each storefront carried its own header, footer,
theme toggle and user cluster, and the pair drifted every time either side
shipped. The chrome **composition** now lives here; everything that differs
between the two storefronts is a **value** the host passes in.

## The rule

No component in this package branches on the host. `config.host` is carried only
so a host can be addressed from CSS or an e2e selector through the `data-host`
attribute the header and footer paint. If a change here needs an
`if (host === 'doctor')`, the thing that differs is a config value that has not
been added yet.

## Exports

| Entry point                         | What it is                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@ds/storefront-shell`              | `StorefrontHeader`, `StorefrontFooter`, `ThemeToggle`, `isHiddenPath`, `matchesPathPattern` and the config types |
| `@ds/storefront-shell/user-cluster` | `HeaderUserCluster`, `HeaderProfileChip` — the signed-in cluster a host puts in the header slot                  |
| `@ds/storefront-shell/theme`        | `applyTheme`, `readStoredTheme`, `persistTheme`, `THEME_FOUC_GUARD` — the `ds-theme` store                       |

The header and the footer are exported **separately** rather than as one
`<Shell>` wrapper: the portal mounts the header from its `@chrome` parallel-route
slot and the footer from its root layout, so they must stay independently
mountable.

Both are **server** components. The only client boundaries are the theme toggle,
the user cluster, and the route-visibility wrapper described below.

## Usage

```tsx
import {
  StorefrontHeader,
  type StorefrontShellConfig,
} from "@ds/storefront-shell";

const SHELL: StorefrontShellConfig = {
  host: "doctor",
  logo: { alt: "Doctor.School — на главную", href: "/" },
  topbar: { text: "…" },
  search: { placeholder: "…", action: "/search" },
  nav: [{ label: "Эфиры", href: "/events" }],
  footer: {
    /* column headings, documents, the single cross link, the foot-note,
       and the giant wordmark with its container-query font size */
  },
};

<StorefrontHeader
  config={SHELL}
  auth={{ status: "guest", loginHref: "/login", label: "Войти / Регистрация" }}
/>;
```

### The auth cluster is DATA, not markup

`auth: ShellAuthState` is a plain serializable value — `{ status: "loading" }`,
`{ status: "guest"; loginHref; label }` or
`{ status: "doctor"; profileHref; label; initials?; links? }`. The package renders it
itself (`ShellAuthCluster`), so the chip's geometry, surface and press chain come
from the ONE design-system definition
(`buttonVariants({ variant: "on-primary", size: "chip" })`) on every host. A host
that handed in its own node would re-open the divergence #2180 closed: two
storefronts drew two different chips into the same bar and the header itself came
out 4px taller on one of them.

The `doctor` branch picks its shape from `initials`: present → the initials
avatar chip (the Academy), absent → the labelled text chip (the Doctor
showcase’s «Личный кабинет», 017 EARS-1). Each storefront still reads its own
session and maps it to this state; #2027 is what gives that read a shared home.
The canvas points plate lands inside the same cluster and is Issue #1559.

`links` is the same branch's optional `ShellLink[]` — the canvas `user.links`
(`ds-shell.dc.html` line 209 for the Academy, line 192 for the Doctor showcase,
which is empty). The package renders them inside the NAV GROUP at both
widths, exactly as the canvas draws them: on desktop at the tail of
`shell-nav-desktop`, after the nav items and before the theme control (canvas
line 33, toggle line 35, chip line 36; testid `shell-auth-link`), and as rows of
the `≡` disclosure after the nav rows (canvas line 50, testid
`shell-auth-link-mobile`). They are not part of the auth cluster element, which
stays the single chip 017 EARS-1 requires; absent and empty are
the same thing, and a host that passes none gets exactly the cluster #2180
shipped. They are NOT top-nav items — the nav stays «Эфиры» alone on both hosts
(owner decision 2026-09-10, #2180) — which is why they travel on the auth state
rather than in `config.nav` (#2243).

### Route visibility

`hiddenOnPaths` is optional. When it is absent — the common case, for a host that
scopes its chrome with a `(storefront)` route group — **no** client boundary is
added at all, and `usePathname` is never reached.

When present, patterns are matched **segment-wise**, not as prefixes:

- a `*` segment matches exactly one segment;
- a trailing `**` segment matches one or more remaining segments;
- every other segment is a literal, and the segment counts must agree — so a
  plain literal pattern is an exact route.

That grammar exists because the portal's two real rules are a set of exact auth
routes and a room route sitting one segment inside a listing that must keep its
chrome. A prefix matcher would hide the listing with it.

### The giant footer wordmark

Pure CSS. The canvas fits it with a `ResizeObserver`; here the host config
carries the container-query length (`footer.giant.fontSize`) and the box is
`container-type: inline-size`. Nothing measures anything at runtime.

## Styling

Tokens and primitives from `@ds/design-system` only — arbitrary Tailwind values
are lint-blocked (AGENTS.md §5/§6, ADR-0013). `src/footer.module.css` is the one
recorded exception: the light/dark brand-mark swap must key off
`<html class="dark">` rather than `prefers-color-scheme`, and the decorative
wordmark's optical values have no utility-scale equivalent.

The chrome bands use the `header-topbar`, `header-topbar-foreground` and
`footer-wordmark` semantic tokens, added with this package for the canvas
announcement band and the giant wordmark.

## Tests

```
pnpm --filter @ds/storefront-shell test
```

Vitest + Testing Library on jsdom, driven by **both** host configs built as
fixtures inside `src/shell.test.tsx` — rendering one composition through two
value sets is what proves the host neutrality the package exists for.

## Who mounts it

| Host                    | Header mount                                                                      | Footer mount                 | Config values                                               | `auth` state mapping                                                                            |
| ----------------------- | --------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Doctor showcase         | `apps/doctor/app/(storefront)/layout.tsx`                                         | same layout                  | `apps/doctor/lib/shell-config.ts` (`DOCTOR_SHELL`)          | `apps/doctor/lib/auth-flow-routes.ts` (`doctorShellAuthState`, server)                          |
| Academy (`apps/portal`) | `apps/portal/app/@chrome/*` via `apps/portal/components/academy-shell-header.tsx` | `apps/portal/app/layout.tsx` | `apps/portal/lib/shell-config.ts` (`academyShellConfig(t)`) | `apps/portal/components/academy-shell-header-client.tsx` (thin client leaf over `useShellAuth`) |

Route visibility differs by mechanism, not by code: the Doctor showcase scopes
the chrome with its `(storefront)` route group and passes no `hiddenOnPaths`,
while the Academy mounts from the root and hides on `/login`, `/register`,
`/verify`, `/reset` and `/webinars/*/room`.

### A11y exception

The BBM topbar (`data-testid="shell-topbar"`) keeps the contrast the
owner-approved canvas paints. That is a recorded exception, not an oversight:
Issue #2189 carries it, and each host's e2e axe scan excludes exactly that leaf
node — never a container band, so every interactive control in the chrome stays
inside the scan.

### Theme

`src/theme.ts` owns the store the `ThemeToggle` reads and writes
(`localStorage["ds-theme"]`, an explicit choice winning over
`prefers-color-scheme`, 006 EARS-12). Each host still keeps its own
`lib/theme.ts` copy for the pre-paint FOUC guard string it inlines into its root
layout — same key, same resolution order; the residue is recorded as a `DEBT.md`
line.
