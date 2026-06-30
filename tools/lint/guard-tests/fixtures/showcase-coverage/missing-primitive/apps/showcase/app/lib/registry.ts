// Fixture for `missing-primitive`: the package exports `./input-otp` but the
// registry only catalogues `button`, so the guard must fail naming `input-otp`.
export interface ShowcaseEntry {
  id: string;
  section: "tokens" | "primitives" | "blocks";
}

export const SHOWCASE_REGISTRY: ShowcaseEntry[] = [
  { id: "button", section: "primitives" },
];

export const NON_CATALOGUED_EXPORTS: string[] = ["cn"];
