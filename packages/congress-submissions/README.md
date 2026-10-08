# `@ds/congress-submissions` — the congress submissions section

The one implementation of «Мои заявки на Конгресс» (feature 046): the author's
section of the congress event — the list of submissions with their status
labels, the kind choice, the oral-talk and poster forms with their authors
editor, the poster draft's birth-date field and age refusal, autosave, the send
panel with its error summary and confirmation, return to draft, withdrawal and
draft deletion. Spec: `apps/docs/content/specs/features/046-congress-submissions/`.
Look: the canvas `design-source/doctor-lk-congress.dc.html`. Registry row:
«Congress submissions cabinet» in
`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`.

Only the doctor storefront mounts it today (`apps/doctor`, `/account/congress`);
the Academy does not (ADR-0015 §3.1). A second host adds a route file and a host
config, never a second section.

## Layering

| Entry      | Path                          | Holds                                                                                                                                   |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | `src/copy.ts`, `src/model/**` | the RU copy and the pure decisions: dates, intake lines, the revision countdown, the actions a submission offers, send checks           |
| `./client` | `src/client/index.ts`         | the same-origin `/v1/me/congress-submissions*` and `/v1/me/birth-date` transport (`credentials: "include"`), `CongressSubmissionsError` |
| `./ui`     | `src/ui/**`                   | `CongressSection` and its parts over `@ds/design-system` primitives; `useAutosave` (1.5 s debounce, flush on blur and page hide)        |
| `./route`  | `src/route/section-route.tsx` | `CongressSectionRoute` — the server mount: a guest goes to the host login with the section as its return target                         |

The model imports only `@ds/schemas`; the UI is tokens-only (`no-arbitrary-tailwind-value`,
`no-primitive-style-override`). Field sets and limits come from `@ds/schemas`
(`packages/schemas/src/congress/`), never restated here.

## Hosts

A host supplies two DATA objects and a route file that renders
`CongressSectionRoute` with them and nothing else (route-mount guard, `mounted`):

- its `@ds/auth-flow` host config — the login route the guest door is built from;
- a `CongressSectionRouteHost`: `path` (where the section is mounted — the return
  target), `accountHref` (the back link), `eventHrefPrefix` (joined to the event
  slug for the congress page link) and `fillingGuideHref` (the congress site's
  filling guide «Как заполнить заявку ↗», opened in a new tab — 046 EARS-36).

Doctor storefront: `apps/doctor/app/(storefront)/account/congress/page.tsx` with
`apps/doctor/lib/congress-submissions.host-config.ts`. The account page links the
section through the shared account card's `congressHref`, passed only for an
account registered for the congress event (`apps/doctor/components/account-screen.tsx`).

## Tests

`pnpm --filter @ds/congress-submissions test` — model, autosave, section
component and route tests (jsdom). The browser journey (V-15) and the axe check
(V-18) run in `apps/doctor/e2e/`.
