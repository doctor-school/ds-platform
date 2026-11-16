import { defineBddConfig } from "playwright-bdd";

export default defineBddConfig({
  features: "../../apps/docs/content/specs/features/*/*-scenarios.feature",
  steps: ["steps/alpha.steps.ts"],
});
