/**
 * GREEN — AC-2 (#828): a canvas-pinned `hover:bg-muted` on a composite row
 * with the explicit machine-readable exception marker (reason REQUIRED)
 * within the window above the tag.
 */
export default function Page() {
  return (
    <main>
      {/* primitives-first-ok: canvas-pinned row hover (profile.dc.html style-hover →
          hoverBg = muted) on a composite logout row — no DS Button variant renders
          a full-width bg-wash row. */}
      <button
        type="button"
        className="w-full border-t border-border py-4 text-left transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none"
        data-testid="logout"
      >
        Sign out
      </button>
    </main>
  );
}
