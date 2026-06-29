import { SectionShell } from "../_components/section-shell";
import { CandidatesView } from "./candidates-view";

/**
 * Candidate/adopted seam (design-system-showcase spec §4, WBS #349) — the
 * Stage-A options surface of `build-ui-from-design-system` (AGENTS.md §6). The
 * showcase is the single live URL behind both design gates; this section is the
 * seam where research-backed candidates for an element class render beside the
 * adopted entry for the owner's pick. The set shown here is an illustrative
 * demonstration of the seam, not a live decision (real sets come from the
 * research-ui-element subagent — deliverable A, #340).
 */
export default function CandidatesPage() {
  return (
    <SectionShell
      title="Candidates (Stage-A)"
      intro="The candidate/adopted seam: 2–3 researched candidate variants of an element class, rendered as the real branded composition beside the adopted entry and clearly role-labelled, for the owner's Stage-A pick on this live URL. The chosen option is then encoded as a standard and the candidates are promoted to adopted or removed. The set below is an illustrative sample wiring the seam — not a live decision."
    >
      <CandidatesView />
    </SectionShell>
  );
}
