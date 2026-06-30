// Self-contained registry stub (no @ds/design-system import) — fixture for the
// `complete` case: every package component export has an entry.
export interface ShowcaseEntry {
  id: string;
  section: "tokens" | "primitives" | "blocks";
}

export const SHOWCASE_REGISTRY: ShowcaseEntry[] = [
  { id: "button", section: "primitives" },
  { id: "input-otp", section: "primitives" },
  { id: "EmailField", section: "primitives" },
  { id: "PhoneField", section: "primitives" },
  { id: "AuthLayout", section: "blocks" },
  { id: "AuthCard", section: "blocks" },
  { id: "OtpFocusScreen", section: "blocks" },
];

export const NON_CATALOGUED_EXPORTS: string[] = [
  "cn",
  "EmailFieldSchema",
  "PhoneFieldSchema",
  "maskPhoneInput",
  "useResendCountdown",
  "maskDestination",
];
