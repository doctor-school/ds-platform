import * as React from "react";

/**
 * Pre-#865 shape of the public event-page program-PDF affordance: an external
 * document anchor bound to a `*Url` prop, shipped WITHOUT `target="_blank"` and
 * WITHOUT a protective `rel`. This is the exact drift the guard must catch — the
 * owner hit same-tab navigation on the public page while the admin surface had
 * the attributes.
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
        <a href={programPdfUrl} className="inline-flex items-center gap-3">
          <span aria-hidden="true">↓</span>
          {programDownloadLabel}
        </a>
      ) : null}
    </div>
  );
}
