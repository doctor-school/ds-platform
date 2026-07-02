---
title: "Frontend component testing (Vitest + jsdom + RTL)"
description: "The sanctioned tier for fast, deterministic DOM-level tests of a React component's JS contract — config shape, the shared jsdom polyfills, and the hard caveat that jsdom does not replace live-stand verification."
lang: en
---

# Frontend component testing — Vitest + jsdom + RTL

**Status:** sanctioned tier (closes the #215 decision-debt from #212/#211).

A **component test** is a fast, deterministic, DOM-level reproduction of a React
component's **JS contract** — value flow, event wiring, conditional rendering,
ARIA/role output — run in a `jsdom` environment under Vitest with React Testing
Library. It sits between the node-env unit tests (`@ds/schemas`, `@ds/api`) and
the Playwright e2e / live-stand drive.

It exists because some bugs are cheapest to pin at the DOM level: the slotted-OTP
regression (#212) needed a deterministic mount + keystroke assertion, not a full
browser. Use a component test when the thing under test is **component behaviour
expressible as DOM + events**; use the live stand (below) when the thing is how it
actually **renders or paints**.

## When to write one

- A component's value/event contract regressed or is non-trivial (controlled
  inputs, auto-submit on completion, masked display, disabled/loading gating).
- You want a fast red→green loop for a fix without booting the app.
- Co-locate the spec next to the component as `*.test.tsx`.

Do **not** reach for it to assert layout, colour, focus-ring geometry, hover, or
anything that needs a real layout/paint engine — jsdom has none (see the caveat).

## Config shape

Each package that has component tests carries a `vitest.config.ts` + a
`vitest.setup.ts`. The canonical shape (live in `apps/portal/` and
`packages/design-system/`):

```ts
// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react"; // JSX transform for the test files

export default defineConfig({
  plugins: [react()],
  resolve: {
    // mirror the package's tsconfig path alias(es); workspace `@ds/*` packages
    // resolve through their own `exports`, so they need no alias here.
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e/**", "tests/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- **`@vitejs/plugin-react`** provides the JSX transform for `*.test.tsx`.
- **`environment: "jsdom"`** is what distinguishes this from the node-env unit
  suites.
- **`include`/`exclude`** keep the jsdom project scoped to co-located component
  specs and out of the Playwright `e2e/` / `tests/` trees.
- Pin Vitest to the workspace's `^4.x` line — keep all packages on one major so
  the jsdom/RTL/`@vitejs/plugin-react` matrix stays coherent (the dependabot
  bumps for these run as a set; see `.claude/rules/repo-conventions.md`).

## The shared jsdom polyfills

`jsdom` ships neither `ResizeObserver` nor a layout engine, and the slotted-OTP
field (`input-otp`) needs both. The `vitest.setup.ts` provides the two stubs
every layout-aware component test ends up needing:

```ts
import "@testing-library/jest-dom/vitest"; // toBeInTheDocument(), toBeDisabled(), …

// `input-otp` observes its hidden input to size the slots → no-op observer.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (
    globalThis as { ResizeObserver?: typeof ResizeObserverStub }
  ).ResizeObserver = ResizeObserverStub;
}

// `input-otp`'s password-manager-badge heuristic polls `elementFromPoint` on a
// timer; jsdom has no layout engine, so it is absent → return null (no hit).
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (document as { elementFromPoint?: () => Element | null }).elementFromPoint =
    () => null;
}
```

These stubs make the tests run; they are no-ops, not behaviour — the tests assert
value flow, never pixel geometry. (`packages/design-system/` and `apps/portal/`
share this polyfill pair, and both now carry the orphan-timer guard below —
adopted by the portal in #434 and by the design-system in #441 as a deliberate
sibling copy (`packages/design-system/orphan-timers.setup.ts`), since the repo has
no shared Vitest-preset package and one helper does not justify inventing a
heavyweight one. The design-system setup additionally keeps its #377
password-manager shim. Folding the common core into a shared Vitest preset /
config package remains a reasonable future consolidation — deferred until a third
consumer makes the abstraction worth it; the two guard copies are cross-noted in
their headers so a future upstream `input-otp` fix updates both.)

## The #434/#441 orphan-timer guard (portal + design-system setups — this one IS behaviour)

`input-otp@1.4.2` schedules a 0/10/50 ms `setTimeout` triple on every value/focus
change and returns **no cleanup** from the scheduling effect. A timer scheduled by
a suite's final keystrokes therefore outlives the file's jsdom environment; the
late callback reaches React's state dispatch, touches the torn-down `window`, and
red-lights the whole `unit` CI job with an intermittent
`ReferenceError: window is not defined` (#405's class, a different root timer —
upstream has no newer release to bump to).

Both the portal and the design-system `vitest.setup.ts` defend deterministically
(`apps/portal/orphan-timers.setup.ts` and `packages/design-system/orphan-timers.setup.ts`,
each contract-tested by a co-located `orphan-timers.test.tsx`): they wrap the
environment's `setTimeout`/`clearTimeout`
to track every pending handle with its scheduling stack, and a setup-level global
`afterEach` — running **after** the file's own hooks (afterEach is LIFO) —
unmounts (`cleanup()`) and defuses every orphan:

- an orphan whose scheduling stack contains an `input-otp` frame is the
  **documented upstream defect** — cleared silently (post-unmount the sync tick
  is dead code);
- **any other** leaked `setTimeout` fails the test on the spot, with the
  scheduling site in the message. That is a real defect in the component or test
  you just wrote: clear the timer in the owning effect's cleanup, or drive the
  test on fake timers (`vi.useFakeTimers()` — the mock swaps the wrapper out, so
  controlled timers are never tracked; `vi.useRealTimers()` restores it).

## The hard caveat — jsdom does not replace the live stand

A passing jsdom component test guards the **JS contract only**. It cannot catch a
browser-only rendering bug, because jsdom does not lay out or paint: no CSS
cascade geometry, no real focus ring, no hover/active states, no `cursor`, no
`prefers-reduced-motion`, no actual fonts. The #212 regression's _real_ symptom
was visual; the component test pins the contract that protects against the
behavioural half, but the visual half is still owned by the live stand.

So a feature checkable in the UI is **not done** on a green component test alone —
it must still be driven in the actual running UI on the dev stand (Playwright),
per AGENTS.md §6 ("Verify UI live before done") and
[`.claude/rules/dev-stand.md`](https://github.com/doctor-school/ds-platform/blob/main/.claude/rules/dev-stand.md).
Component test = fast contract net; live stand = the rendering/paint truth.

## Running

- Per package: `pnpm --filter @ds/portal test` (or `@ds/design-system`) → `vitest run`.
- In CI: these run in the `unit` job (which excludes `@ds/api`); see
  `.claude/rules` and the CI test topology. No `DATABASE_URL` needed — jsdom
  component tests are DB-free.
