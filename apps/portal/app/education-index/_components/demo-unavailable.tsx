import { Button } from "@ds/design-system/button";

import styles from "./education-index.module.css";

/**
 * 045 EARS-10 — a cabinet control the demo shows but never wires: the DS
 * `Button` rendered disabled, described by the visible canvas label «в демо
 * недоступно» (also its `title`, as the canvas draws it). No handler, no href —
 * nothing past this control exists in the demo.
 */
export function DemoUnavailable({ id, label }: { id: string; label: string }) {
  const hintId = `${id}-hint`;
  return (
    <span className={styles.demoControl}>
      <Button
        type="button"
        variant="outline"
        disabled
        title="в демо недоступно"
        aria-describedby={hintId}
      >
        {label}
      </Button>
      <span id={hintId} className={styles.demoHint}>
        в демо недоступно
      </span>
    </span>
  );
}
