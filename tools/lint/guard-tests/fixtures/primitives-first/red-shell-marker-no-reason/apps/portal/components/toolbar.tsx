import { Button } from "@ds/design-system/button";
import NextLink from "next/link";

/**
 * RED — #1103 SHELL: the exception marker WITHOUT a reason must not suppress —
 * the escape hatch is a RECORDED exception, never a bare incantation.
 */
export function Toolbar() {
  return (
    <nav>
      {/* primitives-first-ok: */}
      <Button asChild variant="outline" className="border-2 border-border px-4 py-3 text-sm">
        <NextLink href="/prev">‹</NextLink>
      </Button>
    </nav>
  );
}
