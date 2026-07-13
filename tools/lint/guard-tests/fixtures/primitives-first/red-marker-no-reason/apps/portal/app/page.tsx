/**
 * RED: the exception marker WITHOUT a reason must not suppress — the escape
 * hatch is a RECORDED exception, never a bare incantation.
 */
export default function Page() {
  return (
    <main>
      {/* primitives-first-ok: */}
      <button type="button" className="text-left hover:bg-muted">
        Sign out
      </button>
    </main>
  );
}
