// Red fixture (scope c): a hand-styled raw <a className=…> text link in app
// source — the exact shape of defect #3. It bypasses the @ds/design-system
// `Link` primitive, so it carries no guaranteed hover/focus contract. The guard
// must flag it (WARN-level, exit 1).
export function Page() {
  return (
    <footer>
      <a href="/terms" className="text-primary underline">
        Terms of service
      </a>
    </footer>
  );
}
