import { SectionShell } from "../_components/section-shell";
import { buildTokenGroups } from "../lib/token-groups";
import { TokensView } from "./tokens-view";

/**
 * Tokens section (design-system-showcase spec §3.1). Every token class —
 * colour, typography (family / size / weight / line-height / letter-spacing /
 * roles), spacing, radius, border-width, shadow, motion (duration / easing),
 * z-index, opacity and breakpoints — rendered as specimens. The catalogue is
 * built from the generated manifest (`@ds/design-system/allowed-tokens.json`),
 * and values are read from the compiled CSS custom properties at render time, so
 * the page cannot drift from the token build and a new token surfaces here for
 * free.
 */
export default function TokensPage() {
  const groups = buildTokenGroups();
  return (
    <SectionShell
      title="Tokens"
      intro="Every design token from @ds/design-system, rendered as a live specimen. Names come from the generated token manifest; values are read straight from the compiled CSS custom properties — nothing on this page is hardcoded."
    >
      <TokensView groups={groups} />
    </SectionShell>
  );
}
