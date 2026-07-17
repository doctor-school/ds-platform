import { Button } from "@ds/design-system/button";
import NextLink from "next/link";

/**
 * GREEN — #1103 SHELL escape hatch: a genuinely primitive-less shell with the
 * explicit machine-readable exception marker (reason REQUIRED) within the window
 * above the tag. Same marker honoured by both rules.
 */
export function Toolbar() {
  return (
    <nav>
      {/* primitives-first-ok: canvas-pinned square action box (room canvas) — no
          DS Button variant renders this border-2 chrome; DS-adoption follow-up. */}
      <Button asChild variant="outline" className="border-2 border-border px-4 py-3 text-sm">
        <NextLink href="/prev">‹</NextLink>
      </Button>
    </nav>
  );
}
