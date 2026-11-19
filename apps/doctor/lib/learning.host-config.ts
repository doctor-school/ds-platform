import type { LearningHostConfig } from "@ds/learning/ui";

/** 024 — the `@ds/learning/ui` host-config VALUES of the doctor storefront. */
export const DOCTOR_LEARNING = {
  routes: {
    courses: "/courses",
    schools: "/schools",
    register: "/register",
  },
} satisfies LearningHostConfig;
