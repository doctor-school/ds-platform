export function EventNav({ id }: { id: string }) {
  const router = { push: (_: string) => {} };
  router.push(`/events/${id}`);
  router.replace("/events");
}
