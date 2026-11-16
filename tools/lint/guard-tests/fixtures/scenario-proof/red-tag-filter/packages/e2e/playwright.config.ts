import { defineBddConfig } from "playwright-bdd";

import { authLimitTagsFor } from "./lib/default-auth-limits.js";
import { ordinaryStorefrontTagsFor, signInHostTags } from "./lib/host-tags.js";

const FEATURES = "../../apps/docs/content/specs/features/*/*-scenarios.feature";
const STEPS = ["steps/**/*.ts"];

const testDirFor = (
  hostId: "academy" | "doctor" | "login",
  tags: string,
  missingSteps: "skip-scenario" | "fail-on-gen" = "skip-scenario",
) =>
  defineBddConfig({
    features: FEATURES,
    steps: STEPS,
    outputDir: `.features-gen/${hostId}`,
    tags,
    missingSteps,
  });

export const academy = testDirFor(
  "academy",
  ordinaryStorefrontTagsFor(authLimitTagsFor("academy", process.env)),
);
export const doctor = testDirFor(
  "doctor",
  ordinaryStorefrontTagsFor(authLimitTagsFor("doctor", process.env)),
);
export const login = testDirFor("login", signInHostTags(), "fail-on-gen");
