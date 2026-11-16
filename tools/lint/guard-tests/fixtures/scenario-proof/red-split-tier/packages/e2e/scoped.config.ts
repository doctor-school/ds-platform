import { defineBddConfig } from "playwright-bdd";

const steps = ["scoped/steps.ts"];

export default defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/002-other/002-scenarios.feature",
  steps,
});
