import Link from "next/link";

// Suppression hatch (GREEN): the unresolvable /webinars/<slug>/room target is
// deliberately acknowledged with a NON-EMPTY reason on the same line, so the
// guard skips it and the tree passes.
export function JoinButton({ slug }: { slug: string }) {
  return <Link href={`/webinars/${slug}/room`}>Join room</Link>; // route-target-ok: room route ships in a later slice
}
