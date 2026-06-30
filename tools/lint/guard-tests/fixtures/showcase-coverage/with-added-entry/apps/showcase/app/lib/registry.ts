// Fixture for `with-added-entry`: the `missing-primitive` case with the omitted
// `input-otp` entry now added — proves adding the registry entry fixes the guard.
export interface ShowcaseEntry {
  id: string;
  section: "tokens" | "primitives" | "blocks";
}

export const SHOWCASE_REGISTRY: ShowcaseEntry[] = [
  { id: "button", section: "primitives" },
  { id: "input-otp", section: "primitives" },
];

export const NON_CATALOGUED_EXPORTS: string[] = ["cn"];
