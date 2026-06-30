import { SectionShell } from "../_components/section-shell";
import { BlocksView } from "./blocks-view";

/**
 * Blocks section (design-system-showcase spec §3.3). Each exported block —
 * `AuthCard`, `AuthLayout`, `OtpFocusScreen` — catalogued unit-as-subject like Tokens
 * and Primitives. After two corrected circles (#348 re-staged the branded product
 * screen — a mirror; #390 filled slots with raw prop names — a wireframe), the
 * researched DS-doc middle ground + the owner's Stage-A pick (#386, Layout = Stacked)
 * present each block, vertically, as: a realistic-but-neutral live render + a
 * slots/props table (the real contract) + a state matrix (the states a consumer must
 * handle). The blocks render their own real composed primitives, branded by their own
 * tokens; the showcase is a viewer and re-implements nothing (spec §2.4).
 */
export default function BlocksPage() {
  return (
    <SectionShell
      title="Blocks"
      intro="Each exported design-system block as a reusable unit: a realistic-but-neutral render of the real composed block, its slots / props contract, and the state matrix a consumer must handle — not a finished product screen and not a raw-prop-name wireframe. The blocks render their own real composed primitives, branded by their own tokens."
    >
      <BlocksView />
    </SectionShell>
  );
}
