// A host config is DATA plus package imports: no host-logic import, no callback.
import type { Something } from "@ds/auth-flow";

export default {
  title: "Doctor",
  steps: ["phone", "code"],
  labels: { submit: "Continue" },
} satisfies Something;
