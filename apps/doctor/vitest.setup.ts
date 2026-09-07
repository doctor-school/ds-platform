// Shared jsdom polyfills for the doctor storefront's component tier. The app's
// default Vitest environment is `node` (see vitest.config.ts); files that opt into
// jsdom with a `@vitest-environment jsdom` docblock render `@ds/design-system`
// blocks whose `input-otp` widget touches browser APIs jsdom does not ship. Both
// stubs are guarded so the node-environment suites are untouched. Sibling copies:
// `apps/portal/vitest.setup.ts`, `packages/design-system/vitest.setup.ts`; doc:
// apps/docs/content/architecture/component-testing.md.

// jsdom ships no ResizeObserver; `input-otp` observes the hidden input to size its
// slots, so without this stub the slotted widget throws on mount. A no-op observer
// is sufficient — the tests assert value flow, not pixel geometry.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// jsdom has no layout engine, so `document.elementFromPoint` is absent. `input-otp`'s
// password-manager-badge heuristic polls it on a timer; without this stub the timer
// throws an unhandled error after the test completes. Return null (no element hit).
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (
    document as unknown as { elementFromPoint: () => Element | null }
  ).elementFromPoint = () => null;
}
