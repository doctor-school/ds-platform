"use client";

import { useCallback, useEffect, useState } from "react";
import type { LearningCoursePath } from "@ds/schemas";
import { Badge, Button, Skeleton, cn } from "@ds/design-system";
import { EmptyState } from "@ds/design-system/blocks";

import { createLearningClient } from "../client/index";
import { type LearningHostConfig, stepHref } from "./host-config";
import { LEARNING_UI_COPY as C } from "./learning-ui-copy";
import {
  type NodeTone,
  type PathNode,
  SNAKE,
  buildPathView,
  sectionCurves,
  snakeGeometry,
} from "./path-view";
import { StepIcon } from "./step-icon";

// 024 EARS-14 — the course path block per `design-source/doctor-course.dc.html`
// v16: the «snake» of step nodes in module sections, the «Вы здесь» step with
// «Продолжить», a locked node's reason, the «Модули и уроки» outline, and the
// loading / empty / error states. No game layer (streaks, hearts, XP).

const NODE_TONE: Record<NodeTone, string> = {
  done: "bg-primary-action text-primary-foreground border-primary-action",
  here: "bg-tint text-tint-foreground border-border shadow-md",
  open: "bg-card text-tint-foreground border-primary",
  closed: "bg-muted text-muted-foreground border-hairline",
  club: "bg-tint text-tint-foreground border-border",
  doc: "bg-background text-faint border-dashed border-faint",
};

const MARK_TONE: Record<"done" | "here" | "open" | "closed", string> = {
  done: "bg-primary-action border-primary-action",
  here: "bg-tint border-border",
  open: "bg-card border-primary",
  closed: "bg-muted border-hairline",
};

/** The canvas switches the path to its narrow axis below the desktop grid. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 63.99rem)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export interface CoursePathProps {
  courseSlug: string;
  config: LearningHostConfig;
  /** The server read; null when it failed (the block then offers «Повторить»). */
  initial: LearningCoursePath | null;
}

export function CoursePath({ courseSlug, config, initial }: CoursePathProps) {
  const [path, setPath] = useState(initial);
  const [state, setState] = useState<"ready" | "loading" | "error">(
    initial ? "ready" : "error",
  );
  const narrow = useNarrow();

  const retry = useCallback(async () => {
    setState("loading");
    try {
      setPath(await createLearningClient().coursePath(courseSlug));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [courseSlug]);

  const view = path ? buildPathView(path) : null;
  const g = snakeGeometry(narrow);
  const href = (id: string) => stepHref(config, courseSlug, id);

  return (
    <div className="bg-background pb-16 text-foreground">
      {path ? (
        <section className="px-gutter pt-10">
          <div className="mx-auto flex max-w-content flex-col gap-4">
            <div className="text-eyebrow font-extrabold uppercase tracking-eyebrow text-primary-action">
              {C.courseEyebrow(path.modules.length, view?.lessonCount ?? 0)}
            </div>
            <h1 className="m-0 text-panel-headline font-extrabold leading-display">
              {path.course.title}
            </h1>
          </div>
        </section>
      ) : null}

      {path?.signedIn && view && !view.empty && view.current ? (
        <section className="px-gutter pt-8">
          <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-4 border-2 border-border bg-card px-6 py-4 shadow-lg">
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
              <div className="text-base font-extrabold">
                {C.progress(view.doneLessons, view.lessonCount)}
              </div>
              <div
                role="img"
                aria-label={C.progress(view.doneLessons, view.lessonCount)}
                className="h-2 border border-border bg-muted"
              >
                <div
                  className="h-full bg-primary-action"
                  style={{
                    width: `${view.lessonCount ? (view.doneLessons / view.lessonCount) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <Button asChild>
              <a href={href(view.current.stepId)}>
                {C.continueTo(view.current.lessonNumber)}
              </a>
            </Button>
          </div>
        </section>
      ) : null}

      <section id="path" className="px-gutter pt-section">
        <div className="mx-auto max-w-content">
          <div className="mb-3 flex items-baseline gap-4">
            <h2 className="m-0 whitespace-nowrap text-2xl font-extrabold leading-display tracking-tight">
              {C.pathHeading}
            </h2>
            <span aria-hidden="true" className="flex-1 border-t-2 border-border" />
          </div>
          <p className="mb-8 mt-0 text-sm font-semibold leading-prose text-muted-foreground">
            {C.sequential}
          </p>

          {state === "loading" ? (
            <div aria-busy="true" aria-label={C.loadingPath} className="flex flex-col gap-6">
              <Skeleton className="h-16 w-full" />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={cn("flex", !narrow && i % 2 === 1 ? "justify-end" : "justify-start")}>
                  <div className={narrow ? "w-full" : "w-5/12"}>
                    <Skeleton className="h-18 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : state === "error" ? (
            <div className="flex flex-col items-center gap-4">
              <EmptyState variant="error" title={C.errorPath.title} description={C.errorPath.description} />
              <Button variant="outline" size="sm" onClick={() => void retry()}>
                {C.retry}
              </Button>
            </div>
          ) : view?.empty ? (
            <EmptyState variant="no-records" title={C.emptyPath.title} description={C.emptyPath.description} />
          ) : view ? (
            <div
              className={narrow ? "block" : "grid items-start gap-10"}
              style={narrow ? undefined : { gridTemplateColumns: "minmax(0, 1fr) 22.5rem" }}
            >
              <div className="relative mx-auto flex w-full max-w-160 flex-col">
                {view.sections.map((sec, si) => {
                  const start = view.sections
                    .slice(0, si)
                    .reduce((n, s) => n + s.nodes.length, 0);
                  const prev = view.sections[si - 1]?.nodes.at(-1)?.line ?? null;
                  const next = view.sections[si + 1]?.nodes[0]?.line ?? null;
                  const curves = sectionCurves(sec.nodes, start, g, prev, next);
                  return (
                    <div key={sec.id}>
                      <div
                        id={`module-${sec.id}`}
                        className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-border bg-primary-surface px-6 py-4 text-primary-surface-foreground shadow-btn"
                      >
                        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                          <h3 className="m-0 text-lg font-extrabold leading-tight">{sec.title}</h3>
                          <span className="text-caption font-semibold text-primary-surface-soft">{sec.meta}</span>
                        </div>
                        {sec.progress ? (
                          <span className="flex-none border-2 border-border bg-background px-3 py-1 text-sm font-extrabold tabular-nums text-foreground">
                            {sec.progress}
                          </span>
                        ) : null}
                      </div>
                      <div className="relative" style={{ height: curves.height }}>
                        <svg
                          aria-hidden="true"
                          width={g.width}
                          height={curves.height}
                          className="pointer-events-none absolute top-0 overflow-visible"
                          style={{ left: narrow ? 0 : `calc(50% - ${g.width / 2}px)` }}
                        >
                          <path d={curves.locked} fill="none" strokeWidth={4} strokeLinecap="square" strokeDasharray="8 8" className="stroke-muted-2" />
                          <path d={curves.open} fill="none" strokeWidth={4} strokeLinecap="square" strokeDasharray="8 8" className="stroke-primary-action" />
                          <path d={curves.done} fill="none" strokeWidth={4} strokeLinecap="square" className="stroke-primary-action" />
                        </svg>
                        {sec.nodes.map((n, i) => (
                          <SnakeNode
                            key={n.id}
                            node={n}
                            index={start + i}
                            row={i}
                            narrow={narrow}
                            href={n.kind === "step" && n.openable ? href(n.id) : null}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {narrow ? null : (
                <aside
                  aria-label={C.outlineLabel}
                  className="sticky top-6 flex min-w-0 flex-col self-start border-2 border-border bg-card shadow-lg"
                >
                  <nav aria-label={C.outlineHeading} className="flex flex-col">
                    <div className="px-6 py-3 text-eyebrow font-extrabold uppercase tracking-eyebrow text-muted-foreground">
                      {C.outlineHeading}
                    </div>
                    {view.outline.map((m) => (
                      <div key={m.id} className="flex flex-col">
                        <div className="flex min-h-11 items-center gap-3 border-t border-hairline bg-primary-surface px-6 py-2 text-sm font-extrabold text-primary-surface-foreground">
                          <span className="min-w-0 flex-auto">{m.title}</span>
                          {m.progress ? <span className="flex-none tabular-nums">{m.progress}</span> : null}
                        </div>
                        <ol className="m-0 flex list-none flex-col p-0">
                          {m.lessons.map((l) => (
                            <li key={l.id} className="flex flex-col">
                              <a
                                href={l.firstStepId && l.tone !== "closed" ? href(l.firstStepId) : `#node-${l.firstStepId ?? ""}`}
                                aria-label={l.label}
                                aria-current={l.tone === "here" ? "step" : undefined}
                                data-ghost=""
                                className={cn(
                                  "flex min-h-9 w-full cursor-pointer items-center gap-3 border-t border-hairline px-6 py-2 text-left text-sm font-semibold no-underline transition-colors hover:bg-tint hover:text-tint-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset",
                                  l.tone === "here" ? "bg-tint text-tint-foreground" : "bg-card",
                                  l.tone === "closed" ? "text-muted-foreground" : l.tone === "here" ? "" : "text-foreground",
                                )}
                              >
                                <span aria-hidden="true" className={cn("size-3 flex-none border-2", MARK_TONE[l.tone])} />
                                <span className="min-w-5 flex-none tabular-nums">{l.number}</span>
                                <span title={l.title} className="min-w-0 flex-auto truncate">{l.title}</span>
                              </a>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </nav>
                </aside>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SnakeNode({
  node,
  index,
  row,
  narrow,
  href,
}: {
  node: PathNode;
  index: number;
  row: number;
  narrow: boolean;
  href: string | null;
}) {
  const g = snakeGeometry(narrow);
  const P = SNAKE.pitch;
  const S = SNAKE.side;
  const off = (index % 2 === 0 ? 1 : -1) * g.offset;
  const right = narrow || off > 0;
  const edge = S / 2 + 16;
  const box = cn(
    "absolute inline-flex items-center justify-center border-2 p-0 no-underline",
    NODE_TONE[node.tone],
    href ? "cursor-pointer hover:shadow-btn focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring" : "cursor-default",
  );
  const boxStyle = {
    top: (P - S) / 2,
    width: S,
    height: S,
    left: narrow ? g.axis + off - S / 2 : `calc(50% + ${off - S / 2}px)`,
  };
  const glyph = node.kind === "step" && node.stepType ? node.stepType : node.kind === "club" ? "club" : "doc";
  return (
    <div className="absolute inset-x-0" style={{ top: row * P, height: P }}>
      {!narrow && node.firstOfLesson && node.lessonNumber ? (
        <div
          className="absolute inset-y-0 flex items-center"
          style={right ? { right: `calc(50% + ${-off + edge + 8}px)` } : { left: `calc(50% + ${off + edge + 8}px)` }}
        >
          <span className="border-2 border-border bg-background px-3 py-1 text-eyebrow font-extrabold uppercase tracking-eyebrow">
            {C.lessonLabel(node.lessonNumber)}
          </span>
        </div>
      ) : null}
      {href ? (
        <a id={`node-${node.id}`} href={href} aria-label={node.label} className={box} style={boxStyle}>
          <StepIcon kind={glyph} size={26} />
        </a>
      ) : (
        <span id={`node-${node.id}`} role="img" aria-label={node.label} className={box} style={boxStyle}>
          <StepIcon kind={glyph} size={26} />
        </span>
      )}
      <div
        className={cn(
          "absolute inset-y-0 flex min-w-0 flex-col justify-center gap-1",
          right ? "right-0 items-start text-left" : "left-0 items-end text-right",
        )}
        style={
          narrow
            ? { left: g.axis + g.offset + edge }
            : right
              ? { left: `calc(50% + ${off + edge}px)` }
              : { right: `calc(50% + ${-off + edge}px)` }
        }
      >
        <span className="text-xs font-bold tabular-nums text-faint">
          {narrow && node.firstOfLesson && node.lessonNumber ? `${C.lessonLabel(node.lessonNumber)} · ` : ""}
          {node.kicker}
        </span>
        <span
          className={cn(
            "text-body-compact font-extrabold leading-tight",
            node.tone === "closed" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {node.title}
        </span>
        {node.here ? <Badge>{C.here}</Badge> : null}
        {node.reason ? (
          <span className="text-xs font-semibold text-muted-foreground">{node.reason}</span>
        ) : null}
      </div>
    </div>
  );
}
