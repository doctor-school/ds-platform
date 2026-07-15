import * as React from "react";

/**
 * Post-#865 compliant shape: the external `*Url` document anchor carries
 * `target="_blank"` + `rel="noreferrer"` (attributes on separate lines — the
 * scanner must parse the whole multi-line opening tag as one unit). A second
 * anchor uses a LITERAL external URL with `rel="noopener noreferrer"`. Both PASS.
 */
export function WebinarPageContent({
  programPdfUrl,
  programDownloadLabel,
}: {
  programPdfUrl?: string;
  programDownloadLabel: string;
}) {
  return (
    <div>
      {programPdfUrl ? (
        <a
          href={programPdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-3"
        >
          <span aria-hidden="true">↓</span>
          {programDownloadLabel}
        </a>
      ) : null}
      <a
        href="https://doctor.school/terms"
        target="_blank"
        rel="noopener noreferrer"
      >
        Terms
      </a>
    </div>
  );
}
