import styles from "./education-index.module.css";

/**
 * 045 EARS-11 — the sticky demo plaque on top of both education-index demo
 * pages (canvas `academy-index-demo.dc.html` «плашка демо», l.17). It stays
 * pinned while the page scrolls so no screenshot of the demo reads as live data.
 *
 * Bespoke — temporary demo, no demo-banner unit in @ds/design-system; deleted
 * with 032/035 (EARS-14).
 */
export function DemoPlaque({ children }: { children: string }) {
  return (
    <div data-testid="demo-plaque" className={styles.plaque}>
      <span aria-hidden="true" className={styles.plaqueDot} />
      <span className={styles.plaqueText}>{children}</span>
    </div>
  );
}
