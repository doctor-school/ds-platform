/**
 * Doctor storefront root (`doctor.school/`, ADR-0015 §2) — now a PAGE inside the
 * 017 shell layout (`app/(storefront)/layout.tsx`), not a self-contained screen.
 *
 * The header and footer this file used to draw for itself moved into that
 * layout: EARS-1 defines them once for the whole storefront, and a page-local
 * copy is a defect. What stays here is the page's own content, and today that is
 * only the `h1` — ADR-0015 §2 stage 3 migrates the real marketing routes here out
 * of `apps/promo`, and 017 EARS-2/4/9/10/11 build the home page's own blocks.
 * Until then an empty page under a real shell is the honest surface, and the
 * route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking its real build.
 *
 * The exactly-one-non-empty-`h1` the axe gate asserts belongs to the PAGE, not
 * the shell — the shell wraps many routes and must not own their heading.
 */
export default function DoctorHomePage() {
  return (
    <div className="mx-auto w-full max-w-container-content px-4 py-16 layout:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Doctor.School</h1>
    </div>
  );
}
