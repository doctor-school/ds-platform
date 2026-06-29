import { SectionShell } from "../_components/section-shell";
import { BlocksView } from "./blocks-view";

/**
 * Blocks section (design-system-showcase spec §3.3). Each exported block —
 * `AuthCard`, `AuthLayout`, `OtpFocusScreen` — rendered as the real composed block
 * in its key states, branded. Blocks compose their own real primitives; the showcase
 * re-implements nothing (spec §2.4) and supplies only the representative, i18n-free
 * sample content the app layer would otherwise own.
 */
export default function BlocksPage() {
  return (
    <SectionShell
      title="Blocks"
      intro="Each exported design-system block, rendered as the real composed block in its key states. The blocks compose their own real primitives and carry no copy of their own — the showcase supplies representative sample content (copy, logo, form glue) exactly as a product surface does, on the blocks' own brand tokens."
    >
      <BlocksView />
    </SectionShell>
  );
}
