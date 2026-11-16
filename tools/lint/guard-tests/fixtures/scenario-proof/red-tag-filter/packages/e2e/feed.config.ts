import { defineBddConfig } from "playwright-bdd";

const readonlyTestDir = (host: "doctor" | "academy") =>
  defineBddConfig({
    features: [
      "../../apps/docs/content/specs/features/004-doctor/004-scenarios.feature",
    ],
    steps: ["steps/**/*.ts", "doctor-steps/**/*.ts"],
    outputDir: `.features-gen/readonly-${host}`,
    tags: `@host:${host}`,
  });

export const doctor = readonlyTestDir("doctor");
export const academy = readonlyTestDir("academy");
