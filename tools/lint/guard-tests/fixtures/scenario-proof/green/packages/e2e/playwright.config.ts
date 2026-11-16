import { defineBddConfig } from "playwright-bdd";

const STEPS = ["steps/**/*.ts"];

export default defineBddConfig({
  features: "../../apps/docs/content/specs/features/*/*-scenarios.feature",
  steps: STEPS,
});
