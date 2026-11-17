import type {
  LearningCoursePath,
  LearningElementType,
  LearningNodeState,
} from "@ds/schemas";

import {
  LEARNING_UI_COPY as C,
  STEP_TYPE_LABEL,
  lockReasonText,
  stepMetaParts,
} from "./learning-ui-copy";

// 024 EARS-13 / EARS-14 — the course path read projected onto the «snake» of
// `design-source/doctor-course.dc.html` v16: one node per step, lessons as runs
// of consecutive nodes, a club node per module, the document node last.
//
// The canvas draws three viewers (`renderVals`): a guest — every lesson step
// `plain`, no state word, no reason, the line open throughout; a signed-in
// doctor who has not started (no done step) — done / open / closed from the
// read, no «Вы здесь»; a doctor in progress — the read's `current` (EARS-11)
// is «Вы здесь» (`hereG`). The server's `current` is the same in all three;
// only this projection differs.

/** The node mark of the canvas (`tones`): done · here · open · closed · plain · club · doc. */
export type NodeTone = "done" | "here" | "open" | "closed" | "plain" | "club" | "doc";

/** The canvas viewer: `guest` · `notStarted` · `inProgress` · `completed`. */
export type PathPhase = "guest" | "not-started" | "in-progress" | "completed";
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
  /** The kicker's parts (type, then its canvas meta): each stays whole, the line breaks only after «·». */
  kickerParts: string[];
  title: string;
  /** The accessible name: «Урок N, шаг K. Тип. Название. Статус». */
  label: string;
  /** The summary's reason: every locked step of a signed-in doctor (canvas `sum.hasReason`). */
  reason: string | null;
  /**
   * The line under the node on the path: only the first locked step — the one
   * right after the doctor's next step (canvas `g === doneSteps + 2`).
   */
  lockNote: string | null;
  here: boolean;
  /** A step the doctor may open (not locked). */
  openable: boolean;
  line: LineState;
}

export interface PathSection {
  id: string;
  /** 1-based module position on the path. */
  position: number;
  title: string;
  meta: string;
  progress: string | null;
  nodes: PathNode[];
}

export interface OutlineLesson {
  id: string;
  number: number;
  title: string;
  tone: "done" | "here" | "open" | "closed" | "plain";
  firstStepId: string | null;
  label: string;
}

export interface OutlineModule {
  id: string;
  title: string;
  progress: string | null;
  lessons: OutlineLesson[];
  /** The module's club row (its path node id), when the course has clubs. */
  club: { nodeId: string; tone: OutlineLesson["tone"]; label: string } | null;
}

export interface PathView {
  sections: PathSection[];
  outline: OutlineModule[];
  /** The document row closing the outline (its path node id). */
  documentRow: { nodeId: string; tone: OutlineLesson["tone"]; label: string };
  /** The canvas's exception: one module — no module plates, no module rows. */
  single: boolean;
  lessonCount: number;
  doneLessons: number;
  phase: PathPhase;
  /** «Вы здесь» — only while the doctor is in progress (canvas `hereG`). */
  current: { stepId: string; lessonNumber: number; modulePosition: number } | null;
  /** The step «Начать курс» opens for a doctor who has not started. */
  startStepId: string | null;
  empty: boolean;
}

/** The canvas viewer of a read: a guest, or a doctor by their done steps. */
export function pathPhase(path: LearningCoursePath): PathPhase {
  if (!path.signedIn) return "guest";
  const lessons = path.modules.flatMap((m) => m.lessons);
  if (lessons.length > 0 && lessons.every((l) => l.state.status === "done")) return "completed";
  return lessons.some((l) => l.steps.some((s) => s.state.status === "done"))
    ? "in-progress"
    : "not-started";
}

/** A node's status word; the read's `current` that is not «Вы здесь» reads «Открыт». */
const wordOf = (status: LearningNodeState["status"], here: boolean): string =>
  here ? C.statusWord.current : C.statusWord[status === "current" ? "open" : status];

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
  const phase = pathPhase(path);
  const signedIn = path.signedIn;
  const guest = !signedIn;
  const hereStep = phase === "in-progress" ? (path.current?.stepId ?? null) : null;
  let lessonCount = 0;
  let doneLessons = 0;
  let current: PathView["current"] = null;
  let lockNoted = false;

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
        if (here) current = { stepId: step.id, lessonNumber: lesson.number, modulePosition: mod.position };
        const t = guest ? "plain" : tone(step.state, here);
        const word = guest ? "" : wordOf(step.state.status, here);
        const typeLabel = STEP_TYPE_LABEL[step.type];
        const kickerParts = [typeLabel, ...stepMetaParts(step)];
        const firstLocked = !guest && !lockNoted && step.state.status === "locked";
        if (firstLocked) lockNoted = true;
        nodes.push({
          id: step.id,
          kind: "step",
          stepType: step.type,
          tone: t,
          lessonId: lesson.id,
          lessonNumber: lesson.number,
          firstOfLesson: si === 0,
          kicker: kickerParts.join(" · "),
          kickerParts,
          title: step.title,
          label:
            `${C.lessonLabel(lesson.number)}, шаг ${si + 1}. ${typeLabel}. ${step.title}` +
            (word ? `. ${word}` : ""),
          reason:
            !guest && step.state.status === "locked"
              ? lockReasonText(step.state.reason)
              : null,
          lockNote:
            firstLocked && step.state.status === "locked"
              ? step.state.reason.kind === "previous"
                ? C.lockNote
                : lockReasonText(step.state.reason)
              : null,
          here,
          openable: step.state.status !== "locked",
          line: guest ? "open" : line(step.state),
        });
      });
    }
    if (mod.club) {
      nodes.push({
        id: `club-${mod.id}`,
        kind: "club",
        stepType: null,
        tone: guest ? "club" : mod.club.state.status === "locked" ? "closed" : mod.club.state.status === "done" ? "done" : "club",
        lessonId: null,
        lessonNumber: null,
        firstOfLesson: false,
        kicker: C.club.kicker,
        kickerParts: [C.club.kicker],
        title: C.club.title,
        label: `${C.club.kicker}. ${C.club.title}`,
        reason: null,
        lockNote: null,
        here: false,
        openable: false,
        line: guest ? "open" : line(mod.club.state),
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
        kickerParts: [C.document.kicker],
        title: C.document.title,
        label: `${C.document.kicker}. ${C.document.title}`,
        reason: null,
        lockNote: null,
        here: false,
        openable: false,
        line: guest ? "open" : line(path.document.state),
      });
    }
    return {
      id: mod.id,
      position: mod.position,
      title: C.moduleTitle(mod.position, mod.title),
      meta: C.moduleMeta(mod.lessons.length, mod.club !== null, modMin),
      progress: signedIn
        ? C.moduleProgress(modDone, mod.lessons.length)
        : null,
      nodes,
    };
  });

  const rowTone = (s: LearningNodeState): OutlineLesson["tone"] =>
    guest ? "plain" : s.status === "done" ? "done" : s.status === "locked" ? "closed" : "open";
  const outline = path.modules.map((mod): OutlineModule => {
    const done = mod.lessons.filter((l) => l.state.status === "done").length;
    return {
      id: mod.id,
      title: C.moduleTitle(mod.position, mod.title),
      progress: signedIn ? C.moduleProgress(done, mod.lessons.length) : null,
      lessons: mod.lessons.map((l): OutlineLesson => {
        const here = l.steps.some((s) => s.id === hereStep);
        const t: OutlineLesson["tone"] = here ? "here" : rowTone(l.state);
        const word = guest ? "" : wordOf(l.state.status, here);
        return {
          id: l.id,
          number: l.number,
          title: l.title,
          tone: t,
          firstStepId: l.steps[0]?.id ?? null,
          label: `${C.lessonLabel(l.number)}. ${l.title}` + (word ? `. ${word}` : ""),
        };
      }),
      club: mod.club
        ? {
            nodeId: `club-${mod.id}`,
            tone: rowTone(mod.club.state),
            label: `${C.club.outline}` + (guest ? "" : `. ${wordOf(mod.club.state.status, false)}`),
          }
        : null,
    };
  });
  const docState = path.document.state;

  return {
    sections,
    outline,
    documentRow: {
      nodeId: "document",
      tone: rowTone(docState),
      label: C.document.title + (guest ? "" : `. ${wordOf(docState.status, false)}`),
    },
    single: path.modules.length === 1,
    lessonCount,
    doneLessons,
    phase,
    current,
    startStepId:
      phase === "not-started"
        ? (path.current?.stepId ?? path.modules[0]?.lessons[0]?.steps[0]?.id ?? null)
        : null,
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

// ── Label wrapping on the narrow label column of the snake ──────────────────

export interface TextRun {
  text: string;
  /** A token kept on one line (rendered `white-space: nowrap`). */
  nowrap: boolean;
}

/**
 * A node label split into runs so a short token with an inner hyphen never
 * breaks at it («CHA₂DS₂-» / «VA»): such a token (≤ `max` characters) is one
 * nowrap run, the rest wraps at spaces. A longer hyphenated token may still
 * break — a word wider than the column is worse than a break at its hyphen.
 */
export function keepTokensWhole(text: string, max = 24): TextRun[] {
  const runs: TextRun[] = [];
  for (const piece of text.split(/(\s+)/)) {
    if (!piece) continue;
    // `\p{Pd}`: any dash punctuation — hyphen-minus, hyphen, non-breaking hyphen, en dash.
    const whole = /\S\p{Pd}\S/u.test(piece) && piece.length <= max;
    const last = runs[runs.length - 1];
    if (!whole && last && !last.nowrap) last.text += piece;
    else runs.push({ text: piece, nowrap: whole });
  }
  return runs;
}

/**
 * The canvas scroll-spy (`spy()`): walking the lessons in order, the lesson in
 * view is the last whose first step's top has passed `line` (half the viewport);
 * a missing node stops the walk. 0 = none has passed yet. Returns a 1-based
 * index into `tops`.
 */
export function lessonInView(tops: (number | null)[], line: number): number {
  let cur = 0;
  for (let i = 0; i < tops.length; i++) {
    const top = tops[i];
    if (top === null || top === undefined || top > line) break;
    cur = i + 1;
  }
  return cur;
}
