import { Button } from "@ds/design-system/button";
import { Link as DsLink } from "@ds/design-system/link";
import NextLink from "next/link";

/**
 * GREEN — #1103: interactive DS primitives carrying ONLY positional/spacing +
 * a font-WEIGHT / colour context tweak. `justify-center`, `w-full`, `gap-2`,
 * `min-w-0`, `flex-1` are positional; `font-bold` is a weak weight tweak the
 * primitives tolerate; `text-header-foreground` is a colour, not a size. No
 * strong identity override — the primitive still owns its look. Also: a Button
 * with no className, and a DsLink carrying only a per-surface STATE override
 * (`hover:bg-muted`), which the primitive is the contract owner for.
 */
export function Actions() {
  return (
    <div>
      <Button className="w-full justify-center gap-2">Save</Button>
      <Button variant="outline">Cancel</Button>
      <DsLink asChild className="min-w-0 flex-1 font-bold text-header-foreground hover:bg-muted">
        <NextLink href="/next">Next</NextLink>
      </DsLink>
    </div>
  );
}
