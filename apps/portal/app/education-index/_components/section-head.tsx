import styles from "./education-index.module.css";

/**
 * 045 — the canvas section head (uppercase title + a 2px rule to the right),
 * shared by both demo pages. Temporary demo unit, deleted with 032/035 (EARS-14).
 */
export function SectionHead({
  title,
  tight = false,
}: {
  title: string;
  tight?: boolean;
}) {
  return (
    <div
      className={
        tight
          ? `${styles.sectionHead} ${styles.sectionHeadTight}`
          : styles.sectionHead
      }
    >
      <h2 className={styles.sectionTitle}>{title}</h2>
      <span aria-hidden="true" className={styles.sectionRule} />
    </div>
  );
}
