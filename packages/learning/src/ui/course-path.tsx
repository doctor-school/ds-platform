"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { expertInitials, type LearningCoursePath } from "@ds/schemas";
import {
  Badge,
  Button,
  Link,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  cn,
} from "@ds/design-system";
import { EmptyState, EventSpeakerCard, PointsPlate, type PointsPlateBalances } from "@ds/design-system/blocks";

import { createLearningClient } from "../client/index";
import {
  type LearningHostConfig,
  coursePathHref,
  registerHref,
  stepHref,
} from "./host-config";
import { NodeSummary, summaryAction } from "./node-summary";
import { LEARNING_UI_COPY as C } from "./learning-ui-copy";
import {
  type NodeTone,
  type OutlineLesson,
  type PathNode,
  type PathView,
  SNAKE,
  buildPathView,
  keepTokensWhole,
  lessonInView,
  sectionCurves,
  snakeGeometry,
} from "./path-view";
import { StepIcon } from "./step-icon";

// 024 EARS-14 — the course path block per `design-source/doctor-course.dc.html`
// v16: the «snake» of step nodes in module sections, the «Вы здесь» step with
// «Продолжить», a locked node's reason, the «Модули и уроки» outline (one
// module open — the one in view — and the lesson in view marked, by the
// canvas scroll-spy), and the loading / empty / error states. Multi-module is
// the canvas default; one module drops the module plates and rows. No game
// layer (streaks, hearts, XP).

const NODE_TONE: Record<NodeTone, string> = {
  done: "bg-primary-action text-primary-foreground border-primary-action",
  here: "bg-tint text-tint-foreground border-border shadow-md",
  open: "bg-card text-tint-foreground border-primary",
  closed: "bg-muted text-muted-foreground border-hairline",
  club: "bg-tint text-tint-foreground border-border",
  doc: "bg-background text-faint border-dashed border-faint",
};

/** The canvas title letter-spacing token (no utility class carries it). */
const TITLE_TRACKING = { letterSpacing: "var(--font-letter-spacing-title)" } as const;

const MARK_TONE: Record<OutlineLesson["tone"], string> = {
  done: "bg-primary-action border-primary-action",
  here: "bg-tint border-border",
  open: "bg-card border-primary",
  closed: "bg-muted border-hairline",
};

/** The canvas's smooth jump to a plate or a node (`scrollTo`). */
function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The index of the outline module holding lesson `n` (the one open). */
function openModuleIndex(view: PathView, n: number): number {
  const i = view.outline.findIndex((m) => m.lessons.some((l) => l.number === n));
  return i < 0 ? 0 : i;
}

/**
 * The canvas `spy()`: on scroll (one read per animation frame) the lesson whose
 * first step has passed the middle of the viewport becomes the lesson in view.
 * Desktop only — the narrow axis has no outline.
 *
 * A jump the reader asked for («Продолжить», an outline row, a module row) has
 * already named the lesson in view, so the spy holds until that smooth scroll
 * settles (the page's `scrollend`, or a 1.5 s fallback): with short lessons the next
 * lesson's first step already sits above the line when the target lands at
 * the top, and the spy would otherwise hand the mark past «Вы здесь».
 * Returns `hold`, called before each such jump.
 */
function useScrollSpy(
  view: PathView | null,
  enabled: boolean,
  onLesson: (n: number) => void,
): () => void {
  const latest = useRef(onLesson);
  latest.current = onLesson;
  const held = useRef<(() => void) | null>(null);
  const hold = useCallback(() => {
    held.current?.();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const release = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scrollend", onEnd, true);
      if (held.current === release) held.current = null;
    };
    // Only the page landing ends the jump — the outline column settling its
    // own follow-scroll fires `scrollend` too.
    const onEnd = (e: Event) => {
      if (!(e.target instanceof Element)) release();
    };
    held.current = release;
    window.addEventListener("scrollend", onEnd, true);
    timer = setTimeout(release, 1500);
  }, []);
  useEffect(() => () => held.current?.(), []);
  useEffect(() => {
    if (!enabled || !view) return;
    const lessons = view.outline.flatMap((m) => m.lessons);
    let frame = 0;
    const spy = () => {
      frame = 0;
      if (held.current) return;
      const tops = lessons.map((l) => {
        const el = l.firstStepId ? document.getElementById(`node-${l.firstStepId}`) : null;
        return el ? el.getBoundingClientRect().top : null;
      });
      const cur = lessonInView(tops, (window.innerHeight || 0) * 0.5);
      if (cur) latest.current(lessons[cur - 1]!.number);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(spy);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      if (frame) window.cancelAnimationFrame?.(frame);
    };
  }, [view, enabled]);
  return hold;
}

/**
 * At volume (26 modules) the outline column is taller than the viewport: once
 * the open module's height transition ends, the column scrolls (by itself, never
 * the page) the least distance that shows the whole open module — so the
 * outline visibly follows the reader and the summary stays while it fits.
 */
function useOutlineFollow(aside: React.RefObject<HTMLElement | null>, openModule: number) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const column = aside.current;
      const block = column?.querySelector<HTMLElement>('[data-outline-module="open"]');
      if (!column || !block) return;
      const c = column.getBoundingClientRect();
      const b = block.getBoundingClientRect();
      const delta =
        b.top < c.top ? b.top - c.top : b.bottom > c.bottom ? Math.min(b.bottom - c.bottom, b.top - c.top) : 0;
      if (delta) column.scrollTo({ top: column.scrollTop + delta, behavior: "smooth" });
    }, 300);
    return () => clearTimeout(timer);
  }, [aside, openModule]);
}

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
  /**
   * The 025 balances (`GET /v1/me/points`) for the plate; null for a guest
   * (dashes); absent when the read failed — no plate rather than a number.
   */
  points?: PointsPlateBalances | null;
}

export function CoursePath({ courseSlug, config, initial, points }: CoursePathProps) {
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

  const view = useMemo(() => (path ? buildPathView(path) : null), [path]);
  const g = snakeGeometry(narrow);
  const href = (id: string) => stepHref(config, courseSlug, id);
  const nodes = view ? view.sections.flatMap((sec) => sec.nodes) : [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const selected =
    nodes.find((n) => n.id === selectedId) ??
    nodes.find((n) => n.here) ??
    nodes[0] ??
    null;
  const action = selected
    ? summaryAction(selected, path?.signedIn ?? false, {
        step: href(selected.id),
        register: registerHref(config, coursePathHref(config, courseSlug)),
      })
    : null;
  // The lesson in view (canvas `navN`): the scroll-spy moves it; a pick sets it.
  const [navN, setNavN] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  const holdSpy = useScrollSpy(view, !narrow, (n) => setNavN((prev) => (prev === n ? prev : n)));
  /** A jump the reader asked for: the spy waits until it lands. */
  const jumpTo = (id: string) => {
    holdSpy();
    scrollToId(id);
  };
  const inView = navN ?? selected?.lessonNumber ?? view?.current?.lessonNumber ?? 1;
  const openModule = view ? openModuleIndex(view, inView) : 0;
  useOutlineFollow(asideRef, openModule);

  const select = (n: PathNode) => {
    setSelectedId(n.id);
    if (n.lessonNumber) setNavN(n.lessonNumber);
    if (narrow) setSheetOpen(true);
  };
  /** An outline row: select the node and bring it into view (no Sheet — desktop). */
  const navPick = (nodeId: string, lessonNumber: number | null) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedId(nodeId);
    if (lessonNumber) setNavN(lessonNumber);
    jumpTo(`node-${nodeId}`);
  };
  /** «Продолжить — урок N»: the «Вы здесь» step, selected and flashed, in view. */
  const goHere = (e: React.MouseEvent) => {
    if (!view?.current) return;
    e.preventDefault();
    setSelectedId(view.current.stepId);
    setNavN(view.current.lessonNumber);
    setFlash(true);
    jumpTo(`node-${view.current.stepId}`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 1600);
  };

  return (
    <div className="bg-background pb-16 text-foreground">
      {path ? (
        <section className="px-gutter pt-10">
          <div className="mx-auto flex max-w-content flex-col gap-4">
            <nav
              aria-label={C.breadcrumbLabel}
              className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            >
              {[path.direction?.title, path.school.title]
                .filter((t): t is string => Boolean(t))
                .map((t) => (
                  <span key={t} className="contents">
                    <span>{t}</span>
                    <span aria-hidden="true">›</span>
                  </span>
                ))}
              <span aria-current="page" className="font-semibold text-foreground">
                {path.course.title}
              </span>
            </nav>
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
                {C.progress(view.doneLessons, view.lessonCount, view.single ? undefined : view.current.modulePosition)}
              </div>
              <div
                role="img"
                aria-label={C.progress(view.doneLessons, view.lessonCount, view.single ? undefined : view.current.modulePosition)}
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
              <a href={`#node-${view.current.stepId}`} onClick={goHere}>
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
              <div className="h-16">
                <Skeleton className="h-full w-full" />
              </div>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={cn("flex", !narrow && i % 2 === 1 ? "justify-end" : "justify-start")}>
                  <div className={cn("h-18", narrow ? "w-full" : "w-5/12")}>
                    <Skeleton className="h-full w-full" />
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
              // Server HTML does not know the width yet: the desktop grid and the
              // outline column apply from the desktop breakpoint by CSS, so a phone
              // never scrolls sideways before the narrow switch hydrates.
              className={narrow ? "block" : "block items-start gap-10 lg:grid"}
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
                      {view.single ? null : (
                      <div
                        id={`module-${sec.id}`}
                        className="relative flex scroll-mt-6 flex-wrap items-center gap-x-4 gap-y-2 border-2 border-border bg-primary-surface px-6 py-4 text-primary-surface-foreground shadow-btn"
                      >
                        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                          <h3 className="m-0 text-lg font-extrabold leading-tight" style={TITLE_TRACKING}>{sec.title}</h3>
                          <span className="text-caption font-semibold text-primary-surface-soft">{sec.meta}</span>
                        </div>
                        {sec.progress ? (
                          <span className="flex-none border-2 border-border bg-background px-3 py-1 text-sm font-extrabold tabular-nums text-foreground">
                            {sec.progress}
                          </span>
                        ) : null}
                      </div>
                      )}
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
                            selected={selected?.id === n.id}
                            flash={flash && selected?.id === n.id}
                            onSelect={() => select(n)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {narrow ? null : (
                <aside
                  ref={asideRef}
                  aria-label={C.outlineLabel}
                  className="sticky top-6 hidden min-w-0 flex-col self-start overflow-y-auto border-2 border-border bg-card shadow-lg lg:flex"
                  style={{ maxHeight: "calc(100vh - 2 * var(--space-6))" }}
                >
                  {selected ? (
                    <section
                      aria-label={C.summaryLabel}
                      className="flex-none border-b-2 border-border p-6"
                    >
                      <NodeSummary node={selected} action={action} />
                    </section>
                  ) : null}
                  <nav aria-label={C.outlineHeading} className="flex flex-none flex-col">
                    <div className="px-6 py-3 text-eyebrow font-extrabold uppercase tracking-eyebrow text-muted-foreground">
                      {C.outlineHeading}
                    </div>
                    {view.outline.map((m, mi) => {
                      const open = view.single || mi === openModule;
                      return (
                        <div key={m.id} className="flex flex-col" data-outline-module={open ? "open" : undefined}>
                          {view.single ? null : (
                            // The canvas module row (`nm.go`), a bespoke outline control:
                            // opens the module and brings its plate into view.
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => {
                                setNavN(m.lessons[0]?.number ?? null);
                                jumpTo(`module-${m.id}`);
                              }}
                              className="w-full text-left"
                            >
                              <span
                                className={cn(
                                  "flex min-h-11 w-full cursor-pointer items-center gap-3 border-t border-hairline px-6 py-2 text-sm font-extrabold transition-colors [button:focus-visible>&]:shadow-focus [button:hover>&]:bg-tint [button:hover>&]:text-tint-foreground",
                                  open ? "bg-primary-surface text-primary-surface-foreground" : "bg-card text-foreground",
                                )}
                              >
                                <span className="min-w-0 flex-auto">{m.title}</span>
                                {m.progress ? <span className="flex-none tabular-nums">{m.progress}</span> : null}
                              </span>
                            </button>
                          )}
                          <div
                            className="grid"
                            style={{
                              gridTemplateRows: open ? "1fr" : "0fr",
                              visibility: open ? "visible" : "hidden",
                              transition: `grid-template-rows .25s ease-out, visibility 0s linear ${open ? "0s" : ".25s"}`,
                            }}
                          >
                            <ol className="m-0 flex min-h-0 list-none flex-col overflow-hidden p-0">
                              {m.lessons.map((l) => (
                                <li key={l.id} className="flex flex-col">
                                  <OutlineRow
                                    href={`#node-${l.firstStepId ?? ""}`}
                                    label={l.label}
                                    current={l.number === inView}
                                    tone={l.tone}
                                    onClick={navPick(l.firstStepId ?? "", l.number)}
                                  >
                                    <span className="min-w-5 flex-none tabular-nums">{l.number}</span>
                                    <span title={l.title} className="min-w-0 flex-auto truncate">{l.title}</span>
                                  </OutlineRow>
                                </li>
                              ))}
                              {m.club ? (
                                <li className="flex flex-col">
                                  <OutlineRow
                                    href={`#node-${m.club.nodeId}`}
                                    label={m.club.label}
                                    tone={m.club.tone}
                                    ring={selected?.id === m.club.nodeId}
                                    onClick={navPick(m.club.nodeId, null)}
                                  >
                                    <span className="min-w-0 flex-auto">{C.club.outline}</span>
                                  </OutlineRow>
                                </li>
                              ) : null}
                            </ol>
                          </div>
                        </div>
                      );
                    })}
                    <OutlineRow
                      href={`#node-${view.documentRow.nodeId}`}
                      label={view.documentRow.label}
                      tone={view.documentRow.tone}
                      ring={selected?.id === view.documentRow.nodeId}
                      strong
                      onClick={navPick(view.documentRow.nodeId, null)}
                    >
                      <span className="min-w-0 flex-auto">{C.document.title}</span>
                    </OutlineRow>
                  </nav>
                </aside>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {path?.author ? (
        <section className="px-gutter pt-section">
          <div className="mx-auto max-w-content">
            <EventSpeakerCard
              heading={C.authorHeading}
              name={path.author.name}
              roleKicker={path.author.role}
              affiliation={[path.author.credentials, path.author.affiliation]
                .filter(Boolean)
                .join(", ")}
              {...(path.author.photoUrl ? { photoUrl: path.author.photoUrl } : {})}
              initials={expertInitials(path.author.name)}
            />
          </div>
        </section>
      ) : null}

      {points !== undefined ? (
        <section className="px-gutter pt-section">
          <div className="mx-auto max-w-content">
            <PointsPlate balances={points} />
          </div>
        </section>
      ) : null}

      {narrow && selected ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{selected.title}</SheetTitle>
              <SheetDescription>{selected.kicker}</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <NodeSummary node={selected} action={action} showTitle={false} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

function SnakeNode({
  node,
  index,
  row,
  narrow,
  selected,
  flash,
  onSelect,
}: {
  node: PathNode;
  index: number;
  row: number;
  narrow: boolean;
  selected: boolean;
  /** «Продолжить» just jumped here: the ring stands off further (canvas `flash`). */
  flash: boolean;
  onSelect: () => void;
}) {
  const g = snakeGeometry(narrow);
  const P = SNAKE.pitch;
  const S = SNAKE.side;
  const off = (index % 2 === 0 ? 1 : -1) * g.offset;
  const right = narrow || off > 0;
  const edge = S / 2 + 16;
  const box = cn(
    "inline-flex size-full items-center justify-center border-2 [button:hover>&]:shadow-btn [button:focus-visible>&]:shadow-focus",
    NODE_TONE[node.tone],
    // The canvas selection ring (`--border-width-4` in `--color-ring`, offset
    // `--space-1`; `--space-2` while «Продолжить» flashes it).
    selected && "outline-4 outline-ring",
    selected && (flash ? "outline-offset-8" : "outline-offset-4"),
  );
  const boxStyle = {
    scrollMarginTop: "var(--space-16)",
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
      {/* The canvas node is a bespoke path control (no design-system node
          primitive; recorded in the #4011 build-ui report): the button carries
          only its position, the box inside it carries the look. */}
      <button
        type="button"
        id={`node-${node.id}`}
        aria-label={node.label}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute"
        style={boxStyle}
      >
        <span className={box}>
          <StepIcon kind={glyph} size={26} />
        </span>
      </button>
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
        {/* The label column is narrow (canvas geometry): the kicker breaks only
            after «·», a short hyphenated token never splits, and the title
            clamps to two lines; no part shrinks, so a wrapped kicker plus a
            reason never clips the title's second line. */}
        <span className="shrink-0 text-xs font-bold tabular-nums text-faint">
          {(narrow && node.firstOfLesson && node.lessonNumber
            ? [C.lessonLabel(node.lessonNumber), ...node.kickerParts]
            : node.kickerParts
          ).map((part, i) => (
            <Fragment key={i}>
              {i > 0 ? " · " : null}
              <span className="whitespace-nowrap">{part}</span>
            </Fragment>
          ))}
        </span>
        <span
          title={node.title}
          className={cn(
            "line-clamp-2 shrink-0 text-body-compact font-extrabold leading-tight",
            node.tone === "closed" ? "text-muted-foreground" : "text-foreground",
          )}
          style={TITLE_TRACKING}
        >
          {keepTokensWhole(node.title).map((run, i) =>
            run.nowrap ? (
              <span key={i} className="whitespace-nowrap">
                {run.text}
              </span>
            ) : (
              <Fragment key={i}>{run.text}</Fragment>
            ),
          )}
        </span>
        {node.here ? (
          <span className="flex shrink-0">
            <Badge>{C.here}</Badge>
          </span>
        ) : null}
        {node.reason ? (
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">{node.reason}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A row of the «Модули и уроки» outline: an in-page link to its path node
 * (works before hydration; the click selects and scrolls smoothly). The lesson
 * in view differs only by colour, so neighbouring rows never shift.
 */
function OutlineRow({
  href,
  label,
  tone,
  current,
  ring,
  strong,
  onClick,
  children,
}: {
  href: string;
  label: string;
  tone: OutlineLesson["tone"];
  current?: boolean;
  ring?: boolean;
  strong?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      variant="wrapper"
      tone="neutral"
      href={href}
      aria-label={label}
      {...(current === undefined ? {} : { "aria-current": current ? "true" : "false" })}
      onClick={onClick}
    >
      <span
        className={cn(
          "flex w-full items-center gap-3 border-t border-hairline px-6 py-2 text-left text-sm transition-colors hover:bg-tint hover:text-tint-foreground",
          strong ? "min-h-11 font-extrabold" : "min-h-9 font-semibold",
          current ? "bg-tint text-tint-foreground" : "bg-card",
          !current && (tone === "closed" ? "text-muted-foreground" : "text-foreground"),
          ring && "outline-2 -outline-offset-2 outline-ring",
        )}
      >
        <span aria-hidden="true" className={cn("size-3 flex-none border-2", MARK_TONE[tone])} />
        {children}
      </span>
    </Link>
  );
}
