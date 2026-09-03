"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useOne, useUpdate } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system";
import type { EventAdminDetail } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { EventExpertsPanel } from "@/components/event-experts-panel";
import { EventForm } from "@/components/event-form";
import { StreamConfigForm } from "@/components/stream-config-form";
import { LifecycleActions } from "@/components/lifecycle-actions";
import { RecordingsPanel } from "@/components/recordings-panel";
import { EventProjectsPanel } from "@/components/event-projects-panel";
import { EventDirectionsPanel } from "@/components/event-directions-panel";
import { StateBadge } from "@/components/state-badge";
import { eventUpdateVars } from "@/lib/event-update-vars";
import { formatMskDateTime } from "@/lib/msk";

/**
 * Event edit page (design §8) — the single detail surface carrying the aggregate
 * edit (EARS-2, incl. program-PDF replace), the stream config (EARS-3), and the
 * lifecycle action bar (EARS-4/5/6/7). It reads the full `EventAdminDetail` — the
 * single source of truth (EARS-9): the state badge, the МСК air time (EARS-10),
 * the offered transitions, and the current stream config all resolve from one
 * `EventLifecycleState`/aggregate. Mutations re-fetch the detail so the offered
 * transitions + badge stay exactly what the server just wrote.
 *
 * The page renders ONE machine's vocabulary at a time (014 EARS-27): the bar
 * derives its buttons from the server's per-`origin` `validTransitions`, and the
 * stream-config card — a platform-only affordance — is withheld on a `legacy`
 * эфир, which was broadcast off-platform and has no room to configure.
 */
export default function EventEditPage() {
  const t = useTranslations();
  const params = useParams();
  const id = String(params.id);
  const { result: detail, query } = useOne<EventAdminDetail>({
    resource: "events",
    id,
  });
  const { isLoading, refetch } = query;
  const { mutate: update, mutation: updateMutation } = useUpdate();
  const updating = updateMutation.isPending;
  const [editError, setEditError] = useState<string | null>(null);
  const [editOk, setEditOk] = useState(false);
  // Bumped on each landed save so the form can re-baseline itself clean (#1593)
  // — the mutation lives here, so success is this page's fact to report.
  const [savedAt, setSavedAt] = useState(0);

  return (
    <Authenticated key="events-edit" redirectOnFail="/login">
      <AppShell>
        {isLoading || !detail ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-col gap-6">
            <BackToList />
            {/* Narrow viewports stack the state badge under the title block;
                the single-row `justify-between` only holds from `sm` up, where
                the (potentially long) event title and the badge no longer
                compete for the same line (#1399, adopting the #1387/#1222
                list-header pattern). */}
            <div
              className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid="event-detail-header"
            >
              <div>
                <h1 className="text-xl font-extrabold text-foreground">
                  {detail.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {formatMskDateTime(detail.startsAt)} {t("events.mskSuffix")}
                </p>
              </div>
              <StateBadge state={detail.state} />
            </div>

            <Tabs defaultValue="main">
              <TabsList>
                <TabsTrigger value="main" data-testid="tab-main">
                  {t("events.tabs.main")}
                </TabsTrigger>
                <TabsTrigger value="recordings" data-testid="tab-recordings">
                  {t("events.tabs.recordings")}
                </TabsTrigger>
                {/* 012 EARS-7 (#1289) — the event↔expert link editor lives on the
                    event, per 012-design §7 («relationship editors embedded in
                    the existing 007 event form»), in the Stage-A tabbed
                    composition the owner picked (#1282, option B). */}
                <TabsTrigger value="experts" data-testid="tab-experts">
                  {t("events.tabs.experts")}
                </TabsTrigger>
                <TabsTrigger value="projects" data-testid="tab-projects">
                  {t("events.tabs.projects")}
                </TabsTrigger>
                <TabsTrigger value="directions" data-testid="tab-directions">
                  {t("events.tabs.directions")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="main" className="flex flex-col gap-6">
                {/* Lifecycle actions — only the currently-valid transitions (EARS-7). */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t("events.sections.lifecycle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LifecycleActions detail={detail} refetch={() => refetch()} />
                  </CardContent>
                </Card>

                {/* Stream config (EARS-3) — platform эфир only (014 EARS-27).
                    An off-platform (`legacy`) эфир never went live through the
                    006 room and never will: it is an archived recording that
                    already happened elsewhere. Offering it «настроить
                    трансляцию» would put the platform machine's vocabulary on a
                    screen that runs the legacy one, which is exactly what
                    EARS-27 forbids. */}
                {detail.origin === "legacy" ? null : (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("events.sections.stream")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <StreamConfigForm
                        detail={detail}
                        onConfigured={() => refetch()}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Aggregate edit + program-PDF replace (EARS-2). */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t("events.editTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {editError ? (
                      <Alert
                        variant="danger"
                        className="mb-4"
                        data-testid="edit-error"
                      >
                        {editError}
                      </Alert>
                    ) : null}
                    {editOk ? (
                      <Alert
                        variant="success"
                        className="mb-4"
                        data-testid="edit-ok"
                      >
                        {t("events.toast.updated")}
                      </Alert>
                    ) : null}
                    <EventForm
                      detail={detail}
                      submitLabel={t("common.save")}
                      submitting={updating}
                      savedAt={savedAt}
                      onSubmit={(values) => {
                        setEditError(null);
                        setEditOk(false);
                        // The body is projected by `eventUpdateVars`, which owns
                        // the one branch that is a contract and not a rename: an
                        // архивный эфир may legitimately have no «Школа / серия»,
                        // and `UpdateEventRequest.school` is `.min(1).optional()`
                        // — so the key is OMITTED rather than sent empty (014
                        // EARS-24/25). `origin` is the server's fact, which is why
                        // it comes from the detail and not from the form.
                        const vars = eventUpdateVars(values, {
                          legacy: detail.origin === "legacy",
                        });
                        update(
                          { resource: "events", id, values: vars },
                          {
                            onSuccess: () => {
                              setEditOk(true);
                              setSavedAt(Date.now());
                              refetch();
                            },
                            onError: () =>
                              setEditError(t("events.errors.updateFailed")),
                          },
                        );
                      }}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* «Записи» (014 EARS-1/EARS-2) — the recordings panel and the
                  event-level readiness date. It re-fetches the event detail on a
                  readiness-date save so the badge/aggregate above stays the one
                  the server just wrote (EARS-9). */}
              <TabsContent value="recordings">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("recordings.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RecordingsPanel
                      eventId={id}
                      onEventChanged={() => refetch()}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* «Эксперты» (012 EARS-7) — the event↔expert link editor. */}
              <TabsContent value="experts">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("eventExperts.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EventExpertsPanel mode="event" entityId={id} />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* «Проекты» (012 EARS-6, 012-design §7) — the relationship editor
                  is embedded in the existing 007 event form rather than living on
                  a page of its own: a link is authored while looking at the event
                  it belongs to, and a separate screen would make the operator
                  hold both ends in their head. */}
              <TabsContent value="projects">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("eventProjects.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EventProjectsPanel mode="event" entityId={id} />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* «Направления» (012 EARS-11, 012-design §5.1/§7) — the event↔direction
                  editor sits beside the projects tab for the same reason: the
                  «event form» EARS-11 names is this detail surface, and a direction
                  is chosen while looking at the event it classifies. Only
                  already-created, non-retired directions are offerable — the picker
                  authors links, never taxonomy. */}
              <TabsContent value="directions">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("eventDirections.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EventDirectionsPanel mode="event" entityId={id} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </AppShell>
    </Authenticated>
  );
}
