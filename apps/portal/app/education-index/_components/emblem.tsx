import type { Emblem as EmblemData, EmblemMark } from "@/lib/education-index-demo/fixtures";

import styles from "./education-index.module.css";

/**
 * 045 — an organisation emblem: identity plate + two-letter monogram + a 14×14
 * geometric mark in the top-right corner (canvas `academy-index-demo.dc.html`
 * `MK` + the emblem span). Inline SVG, never a raster image (045-design «No chart
 * primitive»). Decorative: the organisation name always renders beside it.
 *
 * Bespoke — temporary demo, no emblem unit in @ds/design-system; deleted with
 * 032/035 (EARS-14).
 */

const MARKS: Record<EmblemMark, string> = {
  romb: "M7 0L14 7L7 14L0 7Z",
  semis: "M0 6A7 6 0 0 1 14 6Z M0 8A7 6 0 0 0 14 8Z",
  ring: "M0 7a7 7 0 1 0 14 0a7 7 0 1 0 -14 0Z M3 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z M5.3 7a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0Z",
  tri: "M7 0L14 14L0 14Z",
  notch: "M0 0H14V14H0Z M7 7H14V14H7Z",
  stripes: "M0 0H14V3H0Z M0 5.5H14V8.5H0Z M0 11H14V14H0Z",
  hex: "M3.5 0H10.5L14 7L10.5 14H3.5L0 7Z",
  drop: "M7 0C7 0 13 6.5 13 9A6 5 0 0 1 1 9C1 6.5 7 0 7 0Z",
  cross: "M5 0H9V4H5Z M0 5H4V9H0Z M5 5H9V9H5Z M10 5H14V9H10Z M5 10H9V14H5Z",
  wave: "M0 5Q3.5 1 7 5T14 5V9Q10.5 13 7 9T0 9Z",
  half: "M0 11A7 7 0 0 1 14 11Z",
  diag: "M0 6L6 0H9.5L0 9.5Z M4.5 14L14 4.5V8L8 14Z",
};

/** Canvas emblem sizes: plate, monogram size, mark size, inset. */
const SIZES = {
  xs: [26, 10, 7, 3],
  sm: [28, 10, 8, 3],
  md: [36, 13, 10, 4],
  lg: [40, 15, 11, 5],
} as const;

export function Emblem({
  emblem,
  size = "lg",
}: {
  emblem: EmblemData;
  size?: keyof typeof SIZES;
}) {
  const [box, mono, mark, inset] = SIZES[size];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className={`${styles.emblem} ${emblem.ink === "light" ? styles.emblemLight : styles.emblemDark}`}
    >
      <rect width={box} height={box} fill={emblem.plate} />
      <text
        x={inset}
        y={box - inset}
        fontSize={mono}
        className={styles.emblemMono}
      >
        {emblem.mono}
      </text>
      <svg
        x={box - inset - mark}
        y={inset}
        width={mark}
        height={mark}
        viewBox="0 0 14 14"
      >
        <path d={MARKS[emblem.mark]} fillRule="evenodd" opacity={0.9} />
      </svg>
    </svg>
  );
}
