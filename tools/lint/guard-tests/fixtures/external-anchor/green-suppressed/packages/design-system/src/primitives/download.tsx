import * as React from "react";

/**
 * Suppression hatch: a deliberate same-tab external anchor is acknowledged with
 * `// external-anchor-ok: <reason>` on the opening-tag line. The reason is
 * required. With the marker present the external `*Url` anchor — otherwise a red
 * (no target/rel) — PASSES.
 */
export function Download({ exportUrl }: { exportUrl: string }) {
  return (
    <a href={exportUrl}> {/* external-anchor-ok: same-tab CSV export is intentional */}
      Download CSV
    </a>
  );
}
