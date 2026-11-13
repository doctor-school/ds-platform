import type {
  LearningCoursePath,
  LearningElementType,
  LearningNodeState,
} from "@ds/schemas";

import {
  LEARNING_UI_COPY as C,
  STEP_TYPE_LABEL,
  durationText,
  lockReasonText,
} from "./learning-ui-copy";

// 024 EARS-13 / EARS-14 — the course path read projected onto the «snake» of
// `design-source/doctor-course.dc.html` v16: one node per step, lessons as runs
// of consecutive nodes, a club node per module, the document node last.

/** The node mark of the canvas (`tones`): done · here · open · closed · club · doc. */
export type NodeTone = "done" | "here" | "open" | "closed" | "club" | "doc";
type LineState = "done" | "open" | "closed";

export interface PathNode {
  id: string;
  kind: "step" | "club" | "doc";
  stepType: LearningElementType | null;
  tone: NodeTone;
  lessonId: string | null;
  lessonNumber: number | null;
  /** The «Урок N» chip on the lesson's first node. */
  firstOfLesson: boolean;
  kicker: string;
  title: string;
  /** The accessible name: «Урок N, шаг K. Тип. Название. Статус». */
  label: string;
  reason: string | null;
  here: boolean;
  /** A step the doctor may open (not locked). */
  openable: boolean;
  line: LineState;
}

export interface PathSection {
  id: string;
  title: string;
  meta: string;
  progress: string | null;
  nodes: PathNode[];
}

export interface OutlineLesson {
  id: string;
  number: number;
  title: string;
  tone: "done" | "here" | "open" | "closed";
  firstStepId: string | null;
  label: string;
}

export interface PathView {
  sections: PathSection[];
  outline: { id: string; title: string; progress: string | null; lessons: OutlineLesson[] }[];
  lessonCount: number;
  doneLessons: number;
  current: { stepId: string; lessonNumber: number } | null;
  empty: boolean;
}

function tone(state: LearningNodeState, here: boolean): NodeTone {
  if (here) return "here";
  switch (state.status) {
    case "done":
      return "done";
    case "locked":
      return "closed";
    default:
      return "open";
  }
}

function line(state: LearningNodeState): LineState {
  return state.status === "done"
    ? "done"
    : state.status === "locked"
      ? "closed"
      : "open";
}

export function buildPathView(path: LearningCoursePath): PathView {
  const hereStep = path.current?.stepId ?? null;
  const signedIn = path.signedIn;
  let lessonCount = 0;
  let doneLessons = 0;
  let current: PathView["current"] = null;

  const sections: PathSection[] = path.modules.map((mod, mi) => {
    const nodes: PathNode[] = [];
    let modDone = 0;
    let modMin = 0;
    for (const lesson of mod.lessons) {
      lessonCount += 1;
      modMin += lesson.durationMin;
      if (lesson.state.status === "done") {
        doneLessons += 1;
        modDone += 1;
      }
      lesson.steps.forEach((step, si) => {
        const here = step.id === hereStep;
        if (here) current = { stepId: step.id, lessonNumber: lesson.number };
        const t = tone(step.state, here);
        const status = here ? "current" : step.state.status;
        const word = signedIn || status === "locked" ? C.statusWord[status] : "";
        const typeLabel = STEP_TYPE_LABEL[step.type];
        nodes.push({
          id: step.id,
          kind: "step",
          stepType: step.type,
          tone: t,
          lessonId: lesson.id,
          lessonNumber: lesson.number,
          firstOfLesson: si === 0,
          kicker: `${typeLabel} · ${durationText(step.durationMin)}`,
          title: step.title,
          label:
            `${C.lessonLabel(lesson.number)}, шаг ${si + 1}. ${typeLabel}. ${step.title}` +
            (word ? `. ${word}` : ""),
          reason:
            step.state.status === "locked"
              ? lockReasonText(step.state.reason)
              : null,
          here,
          openable: step.state.status !== "locked",
          line: line(step.state),
        });
      });
    }
    if (mod.club) {
      nodes.push({
        id: `club-${mod.id}`,
        kind: "club",
        stepType: null,
        tone: mod.club.state.status === "locked" ? "closed" : mod.club.state.status === "done" ? "done" : "club",
        lessonId: null,
        lessonNumber: null,
        firstOfLesson: false,
        kicker: C.club.kicker,
        title: C.club.title,
        label: `${C.club.kicker}. ${C.club.title}`,
        reason: null,
        here: false,
        openable: false,
        line: line(mod.club.state),
      });
    }
    if (mi === path.modules.length - 1) {
      nodes.push({
        id: "document",
        kind: "doc",
        stepType: null,
        tone: path.document.state.status === "done" ? "done" : "doc",
        lessonId: null,
        lessonNumber: null,
        firstOfLesson: false,
        kicker: C.document.kicker,
        title: C.document.title,
        label: `${C.document.kicker}. ${C.document.title}`,
        reason: null,
        here: false,
        openable: false,
        line: line(path.document.state),
      });
    }
    return {
      id: mod.id,
      title: C.moduleTitle(mod.position, mod.title),
      meta: C.moduleMeta(mod.lessons.length, modMin),
      progress: signedIn
        ? C.moduleProgress(modDone, mod.lessons.length)
        : null,
      nodes,
    };
  });

  const outline = path.modules.map((mod) => {
    const done = mod.lessons.filter((l) => l.state.status === "done").length;
    return {
      id: mod.id,
      title: C.moduleTitle(mod.position, mod.title),
      progress: signedIn ? C.moduleProgress(done, mod.lessons.length) : null,
      lessons: mod.lessons.map((l): OutlineLesson => {
        const here = l.steps.some((s) => s.id === hereStep);
        const t: OutlineLesson["tone"] = here
          ? "here"
          : l.state.status === "done"
            ? "done"
            : l.state.status === "locked"
              ? "closed"
              : "open";
        const word = signedIn || t === "closed" ? C.statusWord[here ? "current" : l.state.status] : "";
        return {
          id: l.id,
          number: l.number,
          title: l.title,
          tone: t,
          firstStepId: l.steps[0]?.id ?? null,
          label: `${C.lessonLabel(l.number)}. ${l.title}` + (word ? `. ${word}` : ""),
        };
      }),
    };
  });

  return {
    sections,
    outline,
    lessonCount,
    doneLessons,
    current,
    empty: lessonCount === 0,
  };
}

// ── The snake geometry of the canvas (P = row pitch, S = node side, px) ─────

export const SNAKE = { pitch: 96, side: 56 } as const;

export interface SnakeGeometry {
  axis: number;
  offset: number;
  width: number;
}

export const snakeGeometry = (mobile: boolean): SnakeGeometry =>
  mobile ? { axis: 64, offset: 24, width: 128 } : { axis: 120, offset: 56, width: 240 };

/** The S-curves of one section, split by the canvas's line states. */
export function sectionCurves(
  nodes: PathNode[],
  startIndex: number,
  g: SnakeGeometry,
  prevLine: LineState | null,
  nextLine: LineState | null,
): { done: string; open: string; locked: string; height: number } {
  const P = SNAKE.pitch;
  const pts = nodes.map((n, i) => {
    const sign = (startIndex + i) % 2 === 0 ? 1 : -1;
    return { x: g.axis + sign * g.offset, y: i * P + P / 2, ls: n.line };
  });
  const height = nodes.length * P;
  const d = { done: "", open: "", locked: "" };
  const pair = (a: LineState, b: LineState): keyof typeof d =>
    a === "done" && b === "done"
      ? "done"
      : a === "closed" || b === "closed"
        ? "locked"
        : "open";
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const my = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y} `;
  };
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (prevLine && first) d[pair(prevLine, first.ls)] += curve({ x: g.axis, y: 0 }, first);
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    if (prev) d[pair(prev.ls, p.ls)] += curve(prev, p);
  });
  if (nextLine && last) d[pair(last.ls, nextLine)] += curve(last, { x: g.axis, y: height });
  return { ...d, height };
}
