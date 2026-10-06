import type { ReactNode } from "react";

/**
 * Fill a `{destination}` template with the address the code went to standing
 * in its own `<strong>` (canvas «ШАГ КОДА»: «Мы отправили код на <b>…</b>.»).
 * The destination is exactly what the visitor typed — email or phone, never
 * masked (#2607): it is their own input, so nothing is disclosed. A long
 * address breaks anywhere inside the column (canvas `overflow-wrap:anywhere`).
 * The one rendering of that sentence for every code step, resend note and the
 * reset «Новый пароль» line (003 EARS-42).
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
      <strong className="wrap-anywhere">{destination}</strong>
      {template.slice(at + marker.length)}
    </>
  );
}
