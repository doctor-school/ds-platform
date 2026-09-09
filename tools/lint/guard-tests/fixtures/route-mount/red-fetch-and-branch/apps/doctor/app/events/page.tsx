import { EventsPage } from "@ds/events-storefront";

import { hostConfig } from "./host-config";

export default async function DoctorEventsRoute() {
  const r = await fetch("https://example.invalid/v1/events");
  if (!r.ok) {
    return <p>Не удалось загрузить</p>;
  }
  return <EventsPage config={hostConfig} />;
}
