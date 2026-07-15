import * as React from "react";

/**
 * Empty-reason hatch (RED): the `external-anchor-ok:` marker on the anchor's
 * opening-tag line carries NO reason after the colon (end of line), so the
 * `:\s*\S` suppression pattern must NOT match — the same-tab external `*Url`
 * anchor (missing target/rel) still fails. (Fixture is eslint-ignored data,
 * scanned as raw text by the guard.)
 */
export function Download({ exportUrl }: { exportUrl: string }) {
  return (
    <a href={exportUrl}> // external-anchor-ok:
      Download CSV
    </a>
  );
}
