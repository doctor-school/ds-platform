"use client";

/**
 * 012 EARS-24 — the refusal note shared by every stage of the migration console.
 *
 * The console is an irreversible, one-shot cutover run by an operator who has to
 * be able to quote the refusal into an Issue, so a refusal is NOT flattened into
 * a friendly sentence: the stable error code is rendered verbatim next to the RU
 * explanation, and the per-row defects the API reports (the source UUIDs that are
 * missing, repeated or extra) are listed underneath. Nothing here guesses, and
 * nothing here retries on the operator's behalf.
 *
 * The refusal line itself is the design-system `FormError` primitive (ADR-0013
 * §7): the error tone, the alert role and the glyph are defined once, in
 * `packages/design-system/src/primitives/form.tsx`, never re-typed per screen.
 * The wrapper only adds the console's boxed layout and the defect list, and it
 * carries the `data-testid` so a caller (and the Playwright arc) can assert on
 * the code, the RU explanation and the offending source ids as one block.
 */
import { FormError } from "@ds/design-system/form";

export interface MigrationErrorState {
  /** The stable API refusal code, rendered verbatim. `null` for a local refusal. */
  code: string | null;
  /** RU explanation of what was refused and what did NOT change. */
  text: string;
  /** Per-row defects, already localized by the caller. */
  issues?: string[];
}

/** The subset of the provider's `TaxonomyHttpError` this surface reads. */
export interface HttpErrorLike {
  errorCode?: string;
  fieldErrors?: { path: string; message: string }[];
}

/** Narrow an unknown catch value to the provider's HTTP error shape. */
export function readHttpError(caught: unknown): HttpErrorLike {
  if (typeof caught !== "object" || caught === null) return {};
  const value = caught as {
    errorCode?: unknown;
    fieldErrors?: unknown;
  };
  return {
    ...(typeof value.errorCode === "string"
      ? { errorCode: value.errorCode }
      : {}),
    ...(Array.isArray(value.fieldErrors)
      ? { fieldErrors: value.fieldErrors as { path: string; message: string }[] }
      : {}),
  };
}

export function SpeakerMigrationErrorNote({
  testId,
  state,
}: {
  testId: string;
  state: MigrationErrorState;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 border-2 border-destructive bg-destructive-tint p-3"
    >
      <FormError>
        {state.code ? `${state.code} — ${state.text}` : state.text}
      </FormError>
      {state.issues && state.issues.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-destructive-text">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SpeakerMigrationSuccessNote({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="border-2 border-success bg-success-tint p-3 text-sm text-success-text"
    >
      {children}
    </div>
  );
}
