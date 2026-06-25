// Red fixture (scope c): a bare `next/link` `<Link className="underline">` text
// link carrying its OWN styling — the literal regression from the 2026-06-25
// live review (finding #3): the portal footer links shipped with no hover state
// through green CI because they were raw styled next/link anchors, not routed
// through the DS `Link` primitive. The guard must flag it (WARN-level, exit 1).
import Link from "next/link";

export function Page() {
  return (
    <footer>
      <Link href="/privacy" className="underline">
        Privacy policy
      </Link>
    </footer>
  );
}
