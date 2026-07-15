import Link from "next/link";

// Reproduces the #673 defect: navigation to /webinars/<slug>/room before the
// app/webinars/[slug]/room/page.tsx route exists.
export function JoinButton({ slug }: { slug: string }) {
  return <Link href={`/webinars/${slug}/room`}>Join room</Link>;
}
