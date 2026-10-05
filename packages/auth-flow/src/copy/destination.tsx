import type { ReactNode } from "react";

/**
 * Fill a `{destination}` template with the masked address standing in its own
 * `<strong>` (canvas «ШАГ КОДА»: «Мы отправили код на <b>masked</b>.»). The
 * one rendering of that sentence for every code step (003 EARS-42).
 */
export function withBoldDestination(
  template: string,
  destination: string,
): ReactNode {
  const marker = "{destination}";
  const at = template.indexOf(marker);
  if (at === -1) return template;
  return (
    <>
      {template.slice(0, at)}
      <strong>{destination}</strong>
      {template.slice(at + marker.length)}
    </>
  );
}
