import { Link as DsLink } from "@ds/design-system/link";
import Link from "next/link";

/**
 * RED — #1103 SHELL, single-token edge: a DS `Link` with ONLY `text-sm` (the
 * real `back-to-list` shape). A lone type-size override on a primitive already
 * rebuilds its identity — this is why the threshold is ≥1 strong, not ≥2. The
 * inner `Link` here is `next/link` (classless) — not itself a finding.
 */
export function BackToList() {
  return (
    <DsLink asChild variant="standalone" className="text-sm">
      <Link href="/events">Back</Link>
    </DsLink>
  );
}
