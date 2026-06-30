// Fixture for `missing-block`: the `./blocks` index exports OtpFocusScreen but
// the registry omits it, so the guard must fail naming `OtpFocusScreen`.
export interface ShowcaseEntry {
  id: string;
  section: "tokens" | "primitives" | "blocks";
}

export const SHOWCASE_REGISTRY: ShowcaseEntry[] = [
  { id: "button", section: "primitives" },
  { id: "AuthLayout", section: "blocks" },
  { id: "AuthCard", section: "blocks" },
];

export const NON_CATALOGUED_EXPORTS: string[] = [
  "cn",
  "useResendCountdown",
  "maskDestination",
];
