import { SectionShell } from "../_components/section-shell";
import { PrimitivesView } from "./primitives-view";

/**
 * Primitives section (design-system-showcase spec §3.2). Every exported
 * primitive rendered as the real `@ds/design-system` component across its states
 * × variants × sizes, with an explicit states column. Zero re-implementation —
 * the showcase is a viewer (spec §2.4).
 */
export default function PrimitivesPage() {
  return (
    <SectionShell
      title="Primitives"
      intro="Every exported primitive, rendered as the real component across its variants, sizes and states. Static states (default / disabled / error) render from real props; pointer states (hover / focus / active) are tagged for the forced-pseudo-state capture and exercisable on each live sample."
    >
      <PrimitivesView />
    </SectionShell>
  );
}
