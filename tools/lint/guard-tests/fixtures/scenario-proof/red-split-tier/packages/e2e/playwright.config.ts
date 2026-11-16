import { defineBddConfig } from "playwright-bdd";

const FEATURES = "../../apps/docs/content/specs/features/*/*-scenarios.feature";

export default defineBddConfig({
  features: FEATURES,
  // A comment with a quote ' and a backtick ` must not derail the reader.
  steps: ["steps/**/*.ts"],
});
