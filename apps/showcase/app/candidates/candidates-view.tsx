import { Button } from "@ds/design-system/button";

import {
  CandidateAdoptedBoard,
  type CandidateAdoptedGroup,
} from "../_components/candidate-adopted";

/**
 * Candidate/adopted seam demonstration (design-system-showcase spec §4, WBS
 * #349). This view wires a SAMPLE option-set through the {@link
 * CandidateAdoptedBoard} seam to satisfy the acceptance criterion "demonstrated
 * with a sample 2–3-option set on the live URL" — it is NOT a live Stage-A
 * decision and adopts nothing. Real option-sets are produced by the
 * `research-ui-element` subagent (deliverable A, inline under #340) and rendered
 * through the exact same seam with no surface change.
 *
 * The sample composes the REAL `@ds/design-system` `Button` (never a mock,
 * spec §2.4): each option returns the true rendered control so a reader sees
 * what the seam looks like in practice — adopted entry first, candidates beside
 * it, every entry role-labelled, each with its research provenance.
 */

const SAMPLE_GROUP: CandidateAdoptedGroup = {
  elementClass: "primary-action · emphasis (illustrative)",
  question: "How should the primary submit action be emphasised?",
  notes:
    "Illustrative sample only — wired to demonstrate the seam, not to propose a change to the adopted Button. A real Stage-A set (e.g. the open submit-pending question, #337) is authored by the research-ui-element subagent and renders through this same board unchanged.",
  adopted: {
    id: "solid-default",
    label: "Solid primary (current)",
    summary:
      "The adopted Button default — a solid primary fill, the single emphasised action per view.",
    sources: [
      {
        label: "Refactoring UI — emphasis by weight",
        href: "https://www.refactoringui.com/",
      },
    ],
    render: () => <Button>Continue</Button>,
  },
  candidates: [
    {
      id: "large-solid",
      label: "Large solid",
      summary:
        "Same solid treatment at the large size — more physical weight for a hero or single-CTA surface.",
      sources: [
        {
          label: "NN/g — Tap target size",
          href: "https://www.nngroup.com/articles/touch-target-size/",
        },
      ],
      render: () => <Button size="lg">Continue</Button>,
    },
    {
      id: "outline-secondary",
      label: "Outline",
      summary:
        "A lower-emphasis outline treatment — for a secondary action competing with a stronger primary.",
      sources: [
        {
          label: "Material — button hierarchy",
          href: "https://m3.material.io/components/buttons/guidelines",
        },
      ],
      render: () => <Button variant="outline">Continue</Button>,
    },
  ],
};

export function CandidatesView() {
  return (
    <div className="flex flex-col gap-2">
      <CandidateAdoptedBoard group={SAMPLE_GROUP} />
    </div>
  );
}
