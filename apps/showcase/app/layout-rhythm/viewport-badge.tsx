"use client";

import { useEffect, useState } from "react";

/**
 * A live read-out of the current viewport width and which layout regime is
 * active (mobile ≤900 / desktop ≥901), so the owner can SEE the breakpoint flip
 * while resizing the window on the live stand. Presentational only — it reads
 * `window.innerWidth`, it defines no token and styles only via the design-system
 * utilities.
 */
export function ViewportBadge() {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const isDesktop = width !== null && width >= 901;

  return (
    <div className="inline-flex items-center gap-2 border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm">
      <span
        aria-hidden
        className={
          "size-2 " + (isDesktop ? "bg-success" : "bg-primary")
        }
      />
      <span className="tabular-nums">
        {width === null ? "—" : `${width}px`}
      </span>
      <span className="text-muted-foreground">
        {width === null
          ? "measuring…"
          : isDesktop
            ? "desktop regime (≥901): container + fluid gutter + stack 28"
            : "mobile regime (≤900): edge-to-edge + 16px gutter + stack 0"}
      </span>
    </div>
  );
}
