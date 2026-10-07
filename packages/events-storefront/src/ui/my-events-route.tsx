import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type MyEventsTab, withReturnTarget } from "@ds/schemas";
import { Container } from "@ds/design-system/container";

import { MY_EVENTS_COPY as COPY } from "../copy/my-events-copy";
import type { MyEventsHostConfig } from "../host-config";
import { fetchMyEvents } from "../server/my-events";
import { forwardedSessionFrom } from "../server/registration-state";
import { MyEventsList } from "./my-events-list";

/** `?tab=recordings` selects «Записи»; anything else is the default «Предстоящие». */
function resolveTab(raw: string | string[] | undefined): MyEventsTab {
  return raw === "recordings" ? "recordings" : "upcoming";
}

/**
 * 005 EARS-6 + 014 EARS-9 — the «Мои события» page (`account-my-events.dc.html`)
 * a host route file mounts with its host config (wave-2 entry gate §2.3 rows
 * 24–27). TWO tabs over the viewer's FULL registration history:
 *
 *   • **Предстоящие** — the registered `published`/`live` events, day-grouped,
 *     NEAREST first, each linking to its event page and admitting the viewer
 *     into a live room through the room href the api resolved for this host;
 *   • **Записи** — every registered `ended` event, month-grouped, newest first,
 *     each badged with its recording state («Запись готовится» included).
 *     `hidden` events appear in NEITHER tab.
 *
 * Each tab is one read of the host's `contentSet.myEventsPath`; the envelope
 * carries BOTH tabs' counts. The tab is explicit URL state (`?tab=recordings`).
 *
 * Authenticated surface: a guest (no/expired session) is sent to the host's door
 * CARRYING this page as the return target (014 EARS-6) — the shared
 * `withReturnTarget` carry over the host's own `routes.login` and
 * `routes.accountEvents`, never anything read off the request. The account
 * FAMILY is a legal landing shape in `@ds/auth-flow` on both hosts.
 *
 * Deviations from the vendored canvas (owner-decided): no «Сертификаты» tab
 * (2026-08-17); no «Направление» filter (014 EARS-12/14, the `facets` wave); no
 * 30-day band or «Показать все N записей» link (014-design §8.3: full history).
 *
 * The mounting route declares `dynamic = "force-dynamic"`: a per-user read whose
 * lifecycle state can change, and a just-registered event must appear (EARS-7).
 */
export async function MyEventsRoute({
  config,
  searchParams,
}: {
  config: MyEventsHostConfig;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tab = resolveTab((await searchParams).tab);
  // The session is fingerprint-bound (ADR-0001 §6) — the shared builder carries
  // the surface the browser bound at login, client address included (#2054).
  const result = await fetchMyEvents(
    config.contentSet.myEventsPath,
    forwardedSessionFrom(await headers()),
    tab,
  );
  if (!result.authenticated) {
    redirect(
      withReturnTarget(config.routes.login, config.routes.accountEvents),
    );
  }

  const { data, counts } = result.events;
  const recordings = tab === "recordings";

  return (
    <main className="bg-background text-foreground">
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          {/* No page-level time zone line: each time carries its own zone label
              (online/hybrid in the viewer zone, offline in МСК) — owner
              2026-10-07, gate §2.3 row 26. */}
          <h1 className="text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
            {COPY.title}
          </h1>
          <p
            className="mt-4 text-caption font-semibold opacity-90"
            data-testid="poster-decor"
          >
            {recordings
              ? COPY.recordingsSubtitle(counts.recordings)
              : COPY.subtitle(counts.upcoming)}
          </p>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
        <MyEventsList
          events={data}
          tab={tab}
          counts={counts}
          routes={config.routes}
        />
      </Container>
    </main>
  );
}
