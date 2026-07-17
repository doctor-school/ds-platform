/**
 * RED — #1103 (a): a role-hacked `<div role="button">` with a hand-assembled
 * state stack — button semantics without the DS `Button` primitive. The state
 * contract belongs to the primitive, not a role attribute on a bare element.
 */
export function FakeButton({ onActivate }: { onActivate: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      className="inline-flex cursor-pointer bg-card hover:bg-muted focus-visible:shadow-focus"
    >
      Go
    </div>
  );
}
