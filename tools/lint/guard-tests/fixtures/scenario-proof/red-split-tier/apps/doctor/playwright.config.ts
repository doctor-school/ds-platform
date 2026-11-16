import { defineBddConfig } from "playwright-bdd";

import { stepsFor } from "./steps-for";

export default defineBddConfig({
  features: "../docs/content/specs/features/*/*-scenarios.feature",
  steps: stepsFor("doctor"),
});
