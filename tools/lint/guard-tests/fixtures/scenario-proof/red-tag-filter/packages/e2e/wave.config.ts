import { defineBddConfig } from "playwright-bdd";

export default defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/001-alpha/001-scenarios.feature",
  steps: ["steps/**/*.ts"],
  tags: "@wave-x",
});
