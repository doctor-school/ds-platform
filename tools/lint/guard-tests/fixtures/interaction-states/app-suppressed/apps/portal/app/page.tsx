// Suppression fixture (scope c): a raw styled link that WOULD violate the
// no-raw-link rule, but carries an explicit, reasoned `interaction-states-ok`
// acknowledgement — the same escape-hatch the primitive scope honours. With the
// marker present the file is skipped, so the tree is clean (exit 0). Without it,
// this `<a className>` would fail like the app-red-raw-anchor case.
/* interaction-states-ok: external mailto link, not a navigable in-app route — DS Link primitive is for routed nav/footer links */
export function Page() {
  return (
    <footer>
      <a href="mailto:support@example.com" className="underline">
        Contact support
      </a>
    </footer>
  );
}
