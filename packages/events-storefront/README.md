# `@ds/events-storefront` — the shared event-storefront unit

The ONE canonical implementation of registering for an event (feature 005),
hosted by both storefronts: the Academy (`apps/portal`, `/webinars/[slug]`) and
the doctor storefront (`apps/doctor`, `/events/[slug]`). Cross-front capability
reuse is a hard rule (AGENTS.md §6, ADR-0013 A1) — an app-to-app import or a
second one-tap control is a defect, not an optimisation. Registry row: «Event
registration one-tap + completion-on-return» in
`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`.

The unit carries the COMMAND and the rules around it: the browser POST, the
progressive-enhancement control, the server action behind it, the per-user
registration read the event page composes, and the completion-on-return decision
rule that resumes a carried intent once a session exists.

## Layering

One direction of dependency, `ui → client → model`; nothing points back.

| Stratum         | Holds                                                       | May import            |
| --------------- | ----------------------------------------------------------- | --------------------- |
| `src/client/**` | `"use client"` browser transport + the resume decision rule | `@ds/schemas`         |
| `src/server/**` | the per-user read and the `"use server"` action, JSX-free   | `@ds/schemas`, `next` |
| `src/ui/**`     | composition over `@ds/design-system` primitives             | everything above      |

## Host-free by construction

The package imports no host: nothing from `apps/portal` or `apps/doctor`, and no
message catalogue. Every string is INJECTED as a prop, and every host-shaped
route fact arrives as data — the control's `returnTo`, and the `ReturnHost`
config (`parseRoomReturn`, `parseIntent`, `defaultLanding`) the resume rule takes.
The return-target GUARDS themselves stay in `@ds/schemas`
(`parseAcademyEventReturnTarget`, `parseDoctorEventReturnTarget`,
`parseReturnTarget`), so what counts as a safe same-origin path is declared once
for the whole platform.

The CARRY side of the round-trip — parking a return target when the visitor
enters the auth flow and consuming it once on the way out (014 EARS-6) — stays in
each host, because the parking store is per-origin. A host resolves and consumes
the target, then hands `completeReturnTarget` the already-resolved value.

## Exports

One entry per layer, so a host — and a host's test — addresses exactly the layer
it projects rather than the whole unit.

| Subpath    | Contract                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | `completeReturnTarget`, `currentReturnTarget`, `ReturnHost` — the decision rule                                                                                                                                                                                  |
| `./client` | `registerForEvent`, `RegistrationError` — the browser transport of the command                                                                                                                                                                                   |
| `./ui`     | `RegisterOneTap` — the progressive-enhancement one-tap control                                                                                                                                                                                                   |
| `./server` | `ForwardedSession`, `forwardedSessionFrom`, `forwardedHeaders`, `hasSessionCookie`, `SESSION_COOKIE_NAME`, `fetchEventRegistrationState`, `registerForEventAction` — the canonical BFF hop (session + `x-forwarded-for` relay, #2054) and the registration reads |

## Hosts

| Host          | Event page                           | Projection                                                                             |
| ------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `apps/portal` | `/webinars/[slug]` (Academy)         | `ReturnHost` = academy intent + room return, default landing `/webinars`; card control |
| `apps/doctor` | `/events/[slug]` (doctor storefront) | `ReturnHost` = doctor intent, default landing `/events`; card control                  |

Both hosts list the package in `transpilePackages` (`next.config.ts`) and depend
on it as `workspace:*`.

### Wiring the completion-on-return rule

A host declares its `ReturnHost` once and hands `completeReturnTarget` the target
it has ALREADY resolved and consumed — the parking store is per-host (014 EARS-6),
so the package never reads a cookie or a URL of its own. The doctor storefront
(`apps/doctor/lib/return-completion.ts`):

```ts
import { parseDoctorEventReturnTarget } from "@ds/schemas";
import type { ReturnHost } from "@ds/events-storefront";

export function doctorReturnHost(defaultLanding: string): ReturnHost {
  return {
    // This host mounts a room but routes every EARS-6 refusal to its own event
    // page rather than through auth, so no room url ever rides a `returnTo` here.
    parseRoomReturn: () => null,
    parseIntent: parseDoctorEventReturnTarget,
    defaultLanding,
  };
}
```

and its sign-in door awaits the answer before navigating
(`apps/doctor/components/login-screen.tsx`):

```ts
const target = await completeReturnTarget(
  returnTarget ?? null,
  doctorReturnHost(landing),
);
router.push(target);
router.refresh();
```

A door that does not navigate — the post-confirmation success card in
`apps/doctor/components/registration-screen.tsx` — awaits the same call and
DISCARDS the landing: what it needs is the command the rule fires, and the card
owns where the doctor goes next.

## Tests

`pnpm --filter @ds/events-storefront test` — vitest, jsdom, co-located
`src/**/*.test.ts{,x}`. Test titles open with `005 EARS-N:` (or the clause's own
feature number) per ADR-0006 §4 and the `ears-naming` guard.
