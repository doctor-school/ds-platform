/**
 * RED (#1874): `/events/${slug}/room` has no matching route in this doctor
 * app-router tree — the #673 defect class, invisible while `APPS` named only
 * portal/admin/academy-demo.
 */
export function JoinButton({ slug }: { slug: string }) {
  return <a href={`/events/${slug}/room`}>В эфир</a>;
}
