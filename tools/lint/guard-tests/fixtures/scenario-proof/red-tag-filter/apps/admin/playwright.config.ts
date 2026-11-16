import { defineBddConfig } from "playwright-bdd";

import { otherTags } from "./lib/other-tags.js";

export const fromEnv = defineBddConfig({
  features: "../docs/content/specs/features/001-alpha/001-scenarios.feature",
  steps: ["../../packages/e2e/steps/**/*.ts"],
  tags: process.env.ADMIN_TAGS,
});

export const fromHelper = defineBddConfig({
  features: "../docs/content/specs/features/001-alpha/001-scenarios.feature",
  steps: ["../../packages/e2e/steps/**/*.ts"],
  tags: otherTags(),
});
