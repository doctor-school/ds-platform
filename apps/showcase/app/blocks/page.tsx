import { SectionShell } from "../_components/section-shell";
import { BlocksView } from "./blocks-view";

/**
 * Blocks section (design-system-showcase spec §3.3). Each exported block —
 * `AuthCard`, `AuthLayout`, `OtpFocusScreen` — catalogued unit-as-subject like Tokens
 * and Primitives: the subject is the block's composition contract (its slots / props
 * and the state matrix a consumer must handle), NOT a re-staged product screen (the
 * #348 inversion, reworked in #386). Each slot is filled by a labelled placeholder
 * that exposes it; the blocks still render their own real primitives, branded by their
 * own tokens, and the showcase re-implements nothing (spec §2.4).
 */
export default function BlocksPage() {
  return (
    <SectionShell
      title="Blocks"
      intro="Each exported design-system block as a reusable unit: its slot / prop contract and the state matrix a consumer must handle — not a finished login or verify screen. Every slot is filled with a labelled, app-supplied placeholder that exposes it; the blocks render their own real composed primitives, branded by their own tokens."
    >
      <BlocksView />
    </SectionShell>
  );
}
