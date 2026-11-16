import { defineBddConfig } from "playwright-bdd";

const testDir = defineBddConfig({
  features: process.env.ADMIN_ONLY_OTHER
    ? "../docs/content/specs/features/002-other/002-scenarios.feature"
    : "../docs/content/specs/features/001-alpha/001-scenarios.feature",
  steps: ["e2e/steps/*.ts"],
});

export default testDir;
