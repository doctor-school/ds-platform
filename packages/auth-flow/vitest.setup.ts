import "@testing-library/jest-dom/vitest";

// The sign-in door's #227 focus screen renders the design-system OTP widget, and
// `input-otp`'s password-manager-badge heuristic polls `document.elementFromPoint`
// on a timer. jsdom has no layout engine, so that method is simply absent and the
// timer throws an unhandled error in the gap between a test finishing and the
// environment tearing down. Return null — nothing is under the point, which is the
// truth here. Same stub the portal tier has carried since it mounted this widget
// (`apps/portal/vitest.setup.ts`).
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (
    document as unknown as { elementFromPoint: () => Element | null }
  ).elementFromPoint = () => null;
}
