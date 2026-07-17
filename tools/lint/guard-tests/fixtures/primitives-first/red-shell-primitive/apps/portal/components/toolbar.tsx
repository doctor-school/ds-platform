import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import NextLink from "next/link";

/**
 * RED — #1103 SHELL: the /webinars month-toolbar shape. `<Button asChild>` used
 * as a bare shell whose className rebuilds the primitive's geometry + type-size
 * (`px-4 text-base`) — a per-surface look-rebuild that drifts (#1101 height
 * mismatch). Multiple strong overrides; font-extrabold is WEAK (not counted).
 */
export function Toolbar() {
  return (
    <nav>
      <Button asChild variant="outline" className="px-4 text-base font-extrabold">
        <NextLink href="/prev">‹</NextLink>
      </Button>
      <Link asChild variant="inline" className="text-caption font-bold text-tint-foreground">
        <NextLink href="/week">← Неделя</NextLink>
      </Link>
    </nav>
  );
}
