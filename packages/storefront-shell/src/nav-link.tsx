import NextLink from "next/link";
import { Link as DsLink } from "@ds/design-system/link";

import type { ShellLink } from "./config";

/**
 * The chrome's two link SHAPES, defined once so the header's nav and the auth
 * cluster's links (canvas `ds-shell.dc.html` lines 33 / 50) cannot drift apart.
 *
 * They live in their own module rather than in `storefront-header.tsx` because
 * `auth-cluster.tsx` needs the desktop shape too, and the header already imports
 * the cluster — a mutual import would be the only alternative.
 */

/** Desktop on-navy link — the muted tier of the canvas, with the press step one
 *  VISIBLE step below the resting tier via ELEMENT opacity (#270), and the press
 *  colour re-anchored off the DS default (`primary-action` IS the band colour, so
 *  the base press painted the label invisible, #1007). */
export function HeaderNavLink({
  item,
  testId,
}: {
  item: ShellLink;
  testId?: string;
}) {
  return (
    <DsLink asChild tone="header-nav">
      <NextLink href={item.href} data-testid={testId}>
        {item.label}
      </NextLink>
    </DsLink>
  );
}

/** One row of the `≡` disclosure — the card-surface list the canvas draws at
 *  line 50, on the DS `mobile-nav-row` variant. */
export function MobileNavRow({
  item,
  testId,
}: {
  item: ShellLink;
  testId?: string;
}) {
  return (
    <DsLink asChild tone="neutral" variant="mobile-nav-row" size="sm">
      <NextLink href={item.href} data-testid={testId}>
        {item.label}
      </NextLink>
    </DsLink>
  );
}
