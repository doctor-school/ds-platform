import Link from "next/link";

// Empty-reason hatch (RED): a bare `// route-target-ok:` with no reason must NOT
// suppress the unresolvable /webinars/<slug>/room target — the guard still fails.
export function JoinButton({ slug }: { slug: string }) {
  return <Link href={`/webinars/${slug}/room`}>Join room</Link>; // route-target-ok:
}
