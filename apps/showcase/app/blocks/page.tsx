import { listDocuments, loadDocument } from "@ds/legal-content";
import { formatEditionLine, LEGAL_DOCUMENT_COPY } from "@ds/design-system/blocks";

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
  // 028 (#1966): the «Документ» section renders the REAL published policy. The
  // loader is Node-only (synchronous `fs`), so it runs HERE, in the server
  // component, and the content arrives at the client catalogue as plain props.
  const policy = loadDocument("privacy-policy");
  if (!policy) {
    throw new Error(
      "showcase /blocks: @ds/legal-content has no `privacy-policy` document",
    );
  }
  const others = listDocuments()
    .filter((doc) => doc.slug !== policy.slug)
    .map((doc) => ({
      slug: doc.slug,
      title: doc.frontmatter.title,
      href: `/documents/${doc.slug}`,
      editionLabel: formatEditionLine(
        doc.frontmatter.edition,
        LEGAL_DOCUMENT_COPY.editionPrefix,
      ),
      // The showcase flags one row so the «обновлено» chip (EARS-11) is visible
      // in the catalogue; in a host this boolean is the re-publication fact.
      updated: true,
    }));

  return (
    <SectionShell
      title="Blocks"
      intro="Each exported design-system block as a reusable unit: a realistic-but-neutral render of the real composed block, its slots / props contract, and the state matrix a consumer must handle — not a finished product screen and not a raw-prop-name wireframe. The blocks render their own real composed primitives, branded by their own tokens."
    >
      <BlocksView
        legalDocument={{
          title: policy.frontmatter.title,
          edition: policy.frontmatter.edition,
          body: policy.body,
        }}
        legalOthers={others}
      />
    </SectionShell>
  );
}
