import { SectionShell } from "../_components/section-shell";
import { CandidatesView } from "./candidates-view";

/**
 * Candidate/adopted seam (design-system-showcase spec §4, WBS #349) — the
 * Stage-A options surface of `build-ui-from-design-system` (AGENTS.md §6). The
 * showcase is the single live URL behind both design gates; this section is the
 * seam where research-backed candidates for an element class render beside the
 * adopted entry for the owner's pick. The current set is the live #1578 Stage-A
 * completed decision for the clickable DataTable row's pressed state.
 */
export default function CandidatesPage() {
  return (
    <SectionShell
      title="Adopted (Stage-A)"
      intro="Stage-A decision for #1578 is recorded: Variant 1 is now the adopted clickable-row pressed state, rendered through the real @ds/design-system DataTable on desktop and mobile."
    >
      <CandidatesView />
    </SectionShell>
  );
}
