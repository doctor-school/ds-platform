/**
 * Doctor storefront root (`doctor.school/`, ADR-0015 §2).
 *
 * This is the app SHELL and nothing else: brand landmark header, a single `h1`
 * naming the site, and a footer. It carries NO mock content — no placeholder
 * copy, no "coming soon", no fake navigation items. ADR-0015 §2 stage 3 migrates
 * the real marketing routes here out of `apps/promo`; until then an empty shell
 * is the honest surface, and the route is registered `deferred` in
 * `tools/lint/prod-surface-manifest.yaml` against the epic that tracks the real
 * build. The app is NOT publicly routed — no compose service, no Caddy vhost
 * (ADR-0015 §7 makes the host cut-over a release-time step).
 *
 * Landmark structure (`header`/`main`/`footer` + exactly one non-empty `h1`) is
 * the part that must be real from day one: it is what the axe gate asserts, and
 * every later page composes inside it.
 */
export default function DoctorHomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-5xl px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">
            Doctor.School
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Doctor.School</h1>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-6 py-6 text-sm text-muted-foreground">
          © Doctor.School
        </div>
      </footer>
    </div>
  );
}
