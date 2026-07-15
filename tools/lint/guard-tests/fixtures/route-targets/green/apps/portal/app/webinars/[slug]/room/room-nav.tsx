import Link from "next/link";
import { redirect } from "next/navigation";

export function RoomNav({ slug, id }: { slug: string; id: string }) {
  if (!slug) redirect("/login?returnTo=/webinars");
  const router = { push: (_: string) => {}, replace: (_: string) => {} };
  router.push(`/webinars/${slug}/room`);
  router.replace("/webinars");
  const external = "https://example.com/x"; // out of scope
  const anchor = "#top"; // out of scope
  return (
    <>
      <Link href="/webinars">All</Link>
      <Link href={`/webinars/${slug}`}>One</Link>
      <a href={external}>ext</a>
      <a href={anchor}>hash</a>
    </>
  );
}
