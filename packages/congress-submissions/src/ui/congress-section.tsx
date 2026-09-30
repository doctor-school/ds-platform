"use client";

import * as React from "react";

import type {
  CongressSubmission,
  CongressSubmissionKind,
  CongressSubmissionKindIntake,
  CongressSubmissionSection,
  CongressSubmissionStatus,
} from "@ds/schemas";
import { Button } from "@ds/design-system/button";
import { Container } from "@ds/design-system/container";
import { FilterChip } from "@ds/design-system/filter-chip";
import { Link } from "@ds/design-system/link";
import { Skeleton } from "@ds/design-system/skeleton";
import { cn } from "@ds/design-system/lib/utils";

import {
  CongressSubmissionsError,
  createDraft,
  deleteDraft,
  fetchSection,
  withdrawSubmission,
} from "../client";
import { COPY, KIND_COPY, STATUS_PLURAL } from "../copy";
import {
  type RowAction,
  actionsFor,
  eventLine,
  intakeLine,
  kindStartable,
  limitLine,
  pickerNote,
  revisionView,
  rowMeta,
} from "../model/model";
import { PosterBand } from "./poster-band";
import { StatusDot, StatusLabel } from "./status";
import { InlineAsk, SubmissionDetail } from "./submission-detail";

/**
 * «Мои заявки на Конгресс» — the author's congress-submissions section (046
 * EARS-4…17), built from `design-source/doctor-lk-congress.dc.html` (final
 * layout А). The host mounts it at its route and hands it data only:
 * where the account page is, where an event page lives and where the sign-in
 * door is. Everything else — the read, the list, the kind choice, the oral
 * form, autosave, send, withdrawal and deletion — lives here, so every
 * storefront that mounts the section renders the same unit.
 */

export interface CongressSectionHost {
  /** The account page the back link returns to. */
  accountHref: string;
  /** The event page path prefix; the event slug is appended. */
  eventHrefPrefix: string;
  /** The sign-in door carrying this section as its return target. */
  signInHref: string;
}

type Load =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; section: CongressSubmissionSection };

const STATUS_ORDER: CongressSubmissionStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "rejected",
  "needs_revision",
  "withdrawn",
];

const PARAM = "submission";

function readOpenId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PARAM);
}

function writeOpenId(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PARAM, id);
  else url.searchParams.delete(PARAM);
  window.history.pushState(null, "", url);
}

export function CongressSection({ host }: { host: CongressSectionHost }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<CongressSubmissionStatus | null>(null);
  const [ask, setAsk] = React.useState<{ id: string; what: "withdraw" | "delete" } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sentNow, setSentNow] = React.useState<Record<string, boolean>>({});
  const [now, setNow] = React.useState(() => new Date());

  const read = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const section = await fetchSection();
      setLoad({ kind: "ready", section });
      setNow(new Date());
    } catch (e) {
      if (e instanceof CongressSubmissionsError && e.status === 401) {
        window.location.assign(host.signInHref);
        return;
      }
      setLoad({ kind: "error" });
    }
  }, [host.signInHref]);

  React.useEffect(() => {
    setOpenId(readOpenId());
    void read();
    const onPop = () => setOpenId(readOpenId());
    window.addEventListener("popstate", onPop);
    // The revision countdown is in minutes.
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.clearInterval(tick);
    };
  }, [read]);

  const open = (id: string | null) => {
    setOpenId(id);
    setPickerOpen(false);
    setAsk(null);
    writeOpenId(id);
    window.scrollTo(0, 0);
  };

  const replace = (next: CongressSubmission) =>
    setLoad((l) =>
      l.kind === "ready"
        ? {
            kind: "ready",
            section: {
              ...l.section,
              submissions: l.section.submissions.map((x) => (x.id === next.id ? next : x)),
            },
          }
        : l,
    );
  const remove = (id: string) =>
    setLoad((l) =>
      l.kind === "ready"
        ? {
            kind: "ready",
            section: {
              ...l.section,
              submissions: l.section.submissions.filter((x) => x.id !== id),
            },
          }
        : l,
    );

  const listBand = (section: CongressSubmissionSection | null) => (
    <PosterBand
      mode="list"
      accountHref={host.accountHref}
      eventLine={section ? eventLine(section.event) : null}
      eventHref={section ? `${host.eventHrefPrefix}${section.event.slug}` : null}
    />
  );

  if (load.kind !== "ready") {
    return (
      <>
        {listBand(null)}
        <Main>
          {load.kind === "loading" ? (
            <div
              data-screen-label="d-lk-congress · загрузка"
              aria-busy="true"
              className="-mx-4 mt-4 border-t border-hairline layout:mx-0 layout:mt-0 layout:border-2"
            >
              {["w-8/12", "w-6/12", "w-9/12", "w-7/12"].map((w, i) => (
                <div
                  key={w}
                  className={cn(
                    "flex items-start gap-6 p-4 layout:px-6 layout:py-5",
                    i ? "border-t border-hairline" : "",
                  )}
                >
                  <div className="h-3 w-30 flex-none">
                    <Skeleton className="h-full w-full" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5">
                    <div className={cn("h-3.5", w)}>
                      <Skeleton className="h-full w-full" />
                    </div>
                    <div className="h-2.75 w-4/12">
                      <Skeleton className="h-full w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              data-screen-label="d-lk-congress · ошибка"
              role="alert"
              className="-mx-4 mt-4 flex flex-wrap items-center gap-4 bg-destructive-tint px-4 py-4.5 layout:mx-0 layout:mt-0 layout:px-6 layout:py-5"
            >
              <div className="min-w-56 flex-1">
                <div className="text-body-compact font-bold text-foreground">
                  {COPY.loadErrorTitle}
                </div>
                <div className="mt-1 text-sm leading-normal text-muted-foreground">
                  {COPY.loadErrorText}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void read()}>
                {COPY.retry}
              </Button>
            </div>
          )}
        </Main>
      </>
    );
  }

  const { section } = load;
  const intakeOf = (k: CongressSubmissionKind): CongressSubmissionKindIntake =>
    section.kinds.find((x) => x.kind === k) ?? {
      kind: k,
      state: "not-announced",
      opensAt: null,
      closesAt: null,
      lastDay: null,
      submitLimit: null,
      used: 0,
      offered: false,
    };

  if (!section.registered) {
    return (
      <>
        {listBand(section)}
        <Main>
          <div
            data-screen-label="d-lk-congress · нет регистрации"
            className="flex flex-wrap items-baseline gap-x-4.5 gap-y-2.5 py-6 layout:border-b layout:border-t-2 layout:border-b-hairline layout:border-t-foreground layout:py-5.5"
          >
            <span className="text-body-compact font-semibold text-foreground">
              {COPY.noRegistration}
            </span>
            {section.registrationUrl ? (
              <Link href={section.registrationUrl} variant="inline">
                {COPY.registrationLink}
              </Link>
            ) : null}
          </div>
        </Main>
      </>
    );
  }

  const subs = section.submissions;
  const opened = openId ? subs.find((x) => x.id === openId) ?? null : null;

  if (opened) {
    return (
      <SubmissionDetail
        key={`${opened.id}:${opened.status}`}
        submission={opened}
        intake={intakeOf(opened.kind)}
        eventTitle={section.event.title}
        consentRequired={section.consentRequired}
        justSent={!!sentNow[opened.id]}
        now={now}
        onReplace={replace}
        onSent={(s) => {
          replace(s);
          setSentNow((m) => ({ ...m, [s.id]: true }));
          setLoad((l) =>
            l.kind === "ready" ? { kind: "ready", section: { ...l.section, consentRequired: false } } : l,
          );
          window.scrollTo(0, 0);
        }}
        onRemoved={(id) => {
          remove(id);
          open(null);
        }}
        onStale={() => void read()}
        onClose={() => open(null)}
      />
    );
  }

  async function start(kind: CongressSubmissionKind) {
    setBusy(true);
    try {
      const draft = await createDraft(section.eventId, kind);
      setLoad((l) =>
        l.kind === "ready"
          ? { kind: "ready", section: { ...l.section, submissions: [draft, ...l.section.submissions] } }
          : l,
      );
      setFilter(null);
      open(draft.id);
    } catch {
      await read();
    } finally {
      setBusy(false);
    }
  }

  async function rowAction(s: CongressSubmission, action: RowAction) {
    if (action === "open") return open(s.id);
    if (action === "withdraw" || action === "delete") {
      setAsk({ id: s.id, what: action });
      return;
    }
    // «Забрать на исправление» — the draft opens for editing (canvas `withdraw`).
    setBusy(true);
    try {
      const back = await withdrawSubmission(s.id, "submitted");
      replace(back);
      setFilter(null);
      open(back.id);
    } catch {
      await read();
    } finally {
      setBusy(false);
    }
  }

  async function confirmAsk() {
    if (!ask) return;
    setBusy(true);
    try {
      if (ask.what === "delete") {
        await deleteDraft(ask.id);
        remove(ask.id);
      } else {
        const s = subs.find((x) => x.id === ask.id);
        if (s) replace(await withdrawSubmission(s.id, s.status));
      }
    } catch {
      await read();
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  const present = STATUS_ORDER.filter((k) => subs.some((x) => x.status === k));
  const active = filter && present.includes(filter) ? filter : null;
  const shown = subs.filter((x) => !active || x.status === active);
  const showPicker = subs.length === 0 || pickerOpen;
  const note = pickerNote(section.kinds);
  const laterKinds = section.kinds.some((k) => !k.offered);

  return (
    <>
      {listBand(section)}
      <Main>
        <div className="flex flex-col gap-2 layout:gap-12">
          {showPicker ? (
            <section data-screen-label="d-lk-congress · выбор вида">
              <SectionHead title={COPY.newSubmission}>
                {subs.length > 0 ? (
                  <Link asChild tone="muted" size="sm">
                    <button type="button" onClick={() => setPickerOpen(false)}>
                      {COPY.collapse}
                    </button>
                  </Link>
                ) : null}
              </SectionHead>
              {note ? (
                <p className="mb-3 text-sm leading-relaxed text-foreground layout:mb-4">{note}</p>
              ) : null}
              {laterKinds ? (
                <p className="mb-3 text-sm leading-relaxed text-foreground layout:mb-4">
                  {COPY.laterKinds}
                </p>
              ) : null}
              <div className="-mx-4 flex flex-col border-y border-hairline bg-card layout:mx-0 layout:grid layout:grid-cols-3 layout:border-2 layout:border-border">
                {(["oral", "poster", "abstract"] as const).map((k, i) => {
                  const it = intakeOf(k);
                  const limitReached =
                    it.submitLimit !== null && it.used >= it.submitLimit;
                  const avail = kindStartable(it) && !limitReached;
                  return (
                    <div
                      key={k}
                      data-testid={`congress-pick-${k}`}
                      className={cn(
                        "flex min-w-0 flex-col gap-1.5 p-4 layout:px-6 layout:py-5.5",
                        i ? "border-t border-hairline layout:border-l layout:border-t-0" : "",
                        avail ? "" : "bg-section",
                      )}
                    >
                      <h3
                        className={cn(
                          "text-lg font-extrabold tracking-tight",
                          avail ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {KIND_COPY[k].label}
                      </h3>
                      {it.offered ? (
                        <p className="text-sm leading-normal text-muted-foreground">
                          {intakeLine(it)}
                        </p>
                      ) : null}
                      {limitLine(it) ? (
                        <p className="text-sm font-semibold text-foreground">{limitLine(it)}</p>
                      ) : null}
                      {avail ? (
                        <Link asChild size="sm" className="mt-auto self-start">
                          <button type="button" disabled={busy} onClick={() => void start(k)}>
                            {COPY.start}
                          </button>
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {subs.length > 0 ? (
            <section data-screen-label="d-lk-congress · список">
              <SectionHead title={COPY.mySubmissions}>
                {!pickerOpen ? (
                  <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
                    {COPY.newSubmissionButton}
                  </Button>
                ) : null}
              </SectionHead>
              <div
                data-screen-label="d-lk-congress · фильтр по статусу"
                role="group"
                aria-label={COPY.mySubmissions}
                className="mb-4 flex flex-wrap items-center gap-2"
              >
                {[null, ...present].map((k) => (
                  <FilterChip
                    key={k ?? "all"}
                    selected={active === k}
                    onClick={() => setFilter(k)}
                  >
                    <span className="inline-flex items-center gap-2">
                      {k ? <StatusDot status={k} /> : null}
                      <span>{k ? STATUS_PLURAL[k] : COPY.all}</span>
                      <span className="text-xs font-semibold tabular-nums">
                        {k ? subs.filter((x) => x.status === k).length : subs.length}
                      </span>
                    </span>
                  </FilterChip>
                ))}
              </div>
              <ul className="-mx-4 flex flex-col border-t border-hairline bg-card layout:mx-0 layout:border-2 layout:border-border layout:shadow-lg">
                {shown.map((s, i) => {
                  const it = intakeOf(s.kind);
                  const acts = actionsFor(s, it, now);
                  const rev = s.status === "needs_revision" ? revisionView(s, now) : null;
                  return (
                    <li
                      key={s.id}
                      data-testid="congress-row"
                      data-status={s.status}
                      onClick={() => open(s.id)}
                      className={cn(
                        "cursor-pointer border-b border-hairline p-4 hover:bg-section layout:border-b-0 layout:px-6 layout:py-5",
                        i ? "layout:border-t" : "",
                      )}
                    >
                      <div className="flex flex-col gap-1.5 layout:flex-row layout:items-start layout:gap-6">
                        <div className="mt-0.5 layout:w-42 layout:flex-none">
                          <StatusLabel status={s.status} />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.25">
                          <Link asChild tone="neutral" className="self-start text-left">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                open(s.id);
                              }}
                            >
                              <span
                                className={cn(
                                  "text-base leading-snug text-pretty",
                                  s.title.trim() ? "" : "text-faint",
                                )}
                              >
                                {s.title.trim() || COPY.untitled}
                              </span>
                            </button>
                          </Link>
                          <div className="text-caption leading-normal text-faint">
                            {rowMeta(s, it, now)}
                          </div>
                          {s.committeeComment ? (
                            <div className="mt-1 flex min-w-0 flex-col items-start gap-1">
                              <span className="line-clamp-2 text-body-compact leading-normal text-foreground">
                                <span
                                  className={cn(
                                    "font-bold",
                                    s.status === "rejected" ? "text-destructive-text" : "text-foreground",
                                  )}
                                >
                                  {COPY.committee}
                                </span>
                                {s.committeeComment}
                              </span>
                              {s.committeeComment.length > 150 ? (
                                <Link asChild tone="muted" size="sm">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      open(s.id);
                                    }}
                                  >
                                    {COPY.readWhole}
                                  </button>
                                </Link>
                              ) : null}
                            </div>
                          ) : null}
                          {rev?.text ? (
                            <div
                              className={cn(
                                "text-caption text-foreground",
                                rev.urgent ? "font-bold" : "font-semibold",
                              )}
                            >
                              {rev.text}
                            </div>
                          ) : null}
                          {ask?.id === s.id ? (
                            <InlineAsk
                              text={ask.what === "withdraw" ? COPY.withdrawAsk : COPY.deleteAsk}
                              yes={ask.what === "withdraw" ? COPY.withdraw : COPY.deleteDraft}
                              busy={busy}
                              onYes={() => void confirmAsk()}
                              onNo={() => setAsk(null)}
                            />
                          ) : null}
                        </div>
                        {acts.primary || acts.secondary.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2 layout:mt-0 layout:max-w-60 layout:flex-col layout:items-end layout:text-right">
                            {acts.primary ? (
                              <Link asChild size="sm">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void rowAction(s, acts.primary!.action);
                                  }}
                                >
                                  {acts.primary.label} →
                                </button>
                              </Link>
                            ) : null}
                            {acts.secondary.map((a) => (
                              <Link key={a.action} asChild tone="muted" size="sm">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void rowAction(s, a.action);
                                  }}
                                >
                                  {a.label}
                                </button>
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </Main>
    </>
  );
}

/** The section body; the host shell owns the page's one `main` landmark. */
function Main({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-12 layout:pb-24 layout:pt-13">
      <Container>{children}</Container>
    </div>
  );
}

function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="-mx-4 flex items-center justify-between gap-3 px-4 pb-3 pt-4.5 layout:mx-0 layout:mb-4 layout:justify-start layout:gap-4.5 layout:p-0">
      <h2 className="whitespace-nowrap text-caption font-extrabold uppercase tracking-eyebrow text-foreground">
        {title}
      </h2>
      <span aria-hidden="true" className="hidden flex-1 border-t-2 border-foreground layout:block" />
      {children}
    </div>
  );
}
