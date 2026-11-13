import type { LearningElementType } from "@ds/schemas";

// The step-type glyphs of `doctor-course.dc.html` / `doctor-lesson.dc.html`
// (24-unit square-cap strokes, `currentColor`).

export type NodeGlyph = LearningElementType | "club" | "doc";

export function StepIcon({ kind, size }: { kind: NodeGlyph; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "square" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "video":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" />
          <path d="M10 9l5 3-5 3z" fill="currentColor" />
        </svg>
      );
    case "test":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" />
          <path d="M8.5 9l1.5 1.5L13 7.5M8.5 15.5l1.5 1.5 3-3" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M12 10v6M9.5 13.5l2.5 2.5 2.5-2.5" />
        </svg>
      );
    case "club":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" />
          <path d="M16 10l5-3v10l-5-3" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="5" />
          <path d="M9 13.5L8 21l4-2 4 2-1-7.5" />
        </svg>
      );
  }
}
