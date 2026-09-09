export const dynamic = "force-dynamic";

export default async function WebinarsPage() {
  const res = await fetch("https://example.invalid/v1/events");
  if (!res.ok) {
    return <p>Не удалось загрузить</p>;
  }
  const events = await res.json();
  return <ul>{events.map((e: { id: string }) => e.id)}</ul>;
}
