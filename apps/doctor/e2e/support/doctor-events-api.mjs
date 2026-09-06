import { createServer } from "node:http";

/**
 * 019 EARS-3 (#1518) — the upstream stand-in for the `/events` route tier.
 *
 * The route reads `GET /v1/storefront/doctor/events` on the SERVER, so the only
 * way to drive the day grouping and the «Показать ещё» horizon walk in a browser
 * is to answer that read. This server answers it with a FIXED, deterministic
 * payload: the assertions are about the route's projection of the contract (day
 * groups rendered as groups, the horizon echoed into the DOM, «показать ещё»
 * widening `to=` in the URL), never about the api's targeting arithmetic — that
 * half is owned by `apps/api/test/storefront/doctor-events-feed.e2e-spec.ts`
 * against the real database.
 *
 * The horizon walk is modelled the way the real service behaves: a read with no
 * explicit `to` gets the default window plus a `nextTo` that COVERS the nearest
 * fixture day beyond it; a read that already carries every fixture day gets
 * `nextTo: null`, because there is nothing left to walk to (#1803).
 */
const port = Number(process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214);

const DEFAULT_FROM = "2026-09-01";
const DEFAULT_TO = "2026-09-15";

const card = (id, startsAt, overrides = {}) => ({
  id,
  // 019 EARS-12: the slug is what the guest hand-off carries into 021 and what
  // the `?resume=` return re-seats on, so the fixture cards must carry it.
  slug: id,
  href: `/events/${id}`,
  startsAt,
  endsAt: null,
  format: "webinar",
  // `kind` is the managed direction ID — the same vocabulary `?kind=` takes —
  // and `kindTitle` is its display projection.
  kind: "6f0f6a1c-0e5a-4d6a-9f2b-6a1c0e5a4d6a",
  kindTitle: "Кардиология",
  title: `Событие ${id}`,
  speaker: "Иванов И. И.",
  source: "Doctor.School",
  nmo: false,
  pulCost: 0,
  signUpCount: 12,
  state: "normal",
  ...overrides,
});

const BASE_DAYS = [
  {
    day: "2026-09-02",
    label: "2 сентября, среда",
    items: [
      card("evt-1", "2026-09-02T09:00:00.000Z"),
      card("evt-2", "2026-09-02T12:30:00.000Z"),
    ],
  },
  {
    day: "2026-09-04",
    label: "4 сентября, пятница",
    items: [card("evt-3", "2026-09-04T15:00:00.000Z")],
  },
];

const WIDENED_DAY = {
  day: "2026-09-20",
  label: "20 сентября, воскресенье",
  items: [card("evt-4", "2026-09-20T10:00:00.000Z")],
};

/** Every day this fixture knows; a read serves the `[from, to)` slice of it. */
const ALL_DAYS = [...BASE_DAYS, WIDENED_DAY];

/**
 * 019 EARS-4 (#1519) — the month the calendar pane paints. `today` is a day
 * with NO events so «сегодня» and the live marker are two independent signals
 * the spec can assert apart: 2026-09-02 is the live day, 2026-09-04 and
 * 2026-09-20 are planned-only days, every other day of September is empty (the
 * contract requires EVERY day of the month to be present).
 */
const MONTH = "2026-09";
const MONTH_TODAY = "2026-09-01";
const MONTH_COUNTS = {
  "2026-09-02": { count: 2, hasLive: true },
  "2026-09-04": { count: 1, hasLive: false },
  "2026-09-20": { count: 1, hasLive: false },
};

const HORIZON_STEP_DAYS = 14;

const addDays = (day, days) => {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const dayGap = (from, to) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );

/** `null` when no fixture day lies at or past `to`; else the covering step boundary. */
function nextToBeyond(to) {
  const beyond = ALL_DAYS.map((group) => group.day)
    .filter((day) => day >= to)
    .sort()
    .at(0);
  if (beyond === undefined) return null;
  const steps = Math.floor(dayGap(to, beyond) / HORIZON_STEP_DAYS) + 1;
  return addDays(to, steps * HORIZON_STEP_DAYS);
}

function monthDays() {
  return Array.from({ length: 30 }, (_unused, index) => {
    const date = `${MONTH}-${String(index + 1).padStart(2, "0")}`;
    const read = MONTH_COUNTS[date] ?? { count: 0, hasLive: false };
    return { date, count: read.count, hasLive: read.hasLive };
  });
}

/**
 * 019 EARS-6 — the «Идёт сейчас» scenario this double serves.
 *
 * Liveness is a SERVER fact in production, so it is a server fact here too: the
 * route may not be able to make the block appear or vanish by waiting, only by
 * asking again. The test-only `POST /__e2e/live` flips the scenario so a spec can
 * prove the block CLEARS ITSELF on the next bounded read — the one behaviour a
 * fixed fixture could never evidence.
 *
 *   registered   — a live эфир this viewer holds a registration for (room entry)
 *   unregistered — the same эфир, guest/unregistered entry (the event page)
 *   none         — nothing targeted is live: the body is `null` and the block
 *                  must be ABSENT from the tree, not hidden
 */
let liveScenario = "none";

const LIVE_SLUG = "prp-questions";
const LIVE_STRIP = {
  eventId: "00000000-0000-4000-8000-0000000000f1",
  slug: LIVE_SLUG,
  title: "Эфир «Вопросы по PRP»",
  school: "Школа ортобиологии",
  href: `/events/${LIVE_SLUG}`,
  endsAt: `${MONTH_TODAY}T17:30:00.000Z`,
  presenceCount: 412,
  viewerIsRegistered: false,
};

/**
 * The entry policy is the SERVER's: a registered viewer — proven by the
 * forwarded `__Host-ds_session` cookie AND the `registered` scenario — is sent
 * to the room; everyone else gets the event page. The route never derives this,
 * which is exactly what the guest spec asserts.
 */
function liveBody(cookie) {
  if (liveScenario === "none") return null;
  const signedIn = (cookie ?? "").includes("__Host-ds_session=");
  const registered = liveScenario === "registered" && signedIn;
  return registered
    ? { ...LIVE_STRIP, href: `/events/${LIVE_SLUG}/room`, viewerIsRegistered: true }
    : LIVE_STRIP;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/health") return json(response, 200, { ok: true });

  // Test-only control: flip the live scenario mid-run so a spec can prove the
  // block clears itself on the next read rather than on a reload.
  if (url.pathname === "/__e2e/live" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        liveScenario = JSON.parse(body || "{}").scenario ?? "none";
      } catch {
        liveScenario = "none";
      }
      json(response, 200, { scenario: liveScenario });
    });
    return undefined;
  }

  // 019 EARS-6 — declared BEFORE the `:idOrSlug` shape for the same reason the
  // real controller declares it first: `live` is a literal route, not a slug.
  if (url.pathname === "/v1/storefront/doctor/events/live") {
    return json(response, 200, liveBody(request.headers.cookie));
  }

  if (url.pathname === "/v1/storefront/doctor/events/month") {
    return json(response, 200, {
      month: url.searchParams.get("month") ?? MONTH,
      today: MONTH_TODAY,
      days: monthDays(),
      targeting: {
        mode: "general",
        specialtyReference: null,
        directionIds: [],
        adjacentDirectionIds: [],
      },
    });
  }

  if (url.pathname === "/v1/storefront/doctor/events") {
    // The window is `[from, to)` — an INCLUSIVE lower and an EXCLUSIVE upper
    // bound, exactly as `DoctorEventsService.feed()` builds it
    // (`gte(startsAt, fromInstant)` / `lt(startsAt, toInstant)`). Deciding the
    // served set from the mere PRESENCE of `to` would let a link that widens to
    // a bound one day short of its own selection look green here and fail in
    // production, so the value is compared, never its existence.
    const from = url.searchParams.get("from") ?? DEFAULT_FROM;
    const to = url.searchParams.get("to") ?? DEFAULT_TO;
    // `day` is deliberately NOT read here: the real service ignores it too
    // (`doctor-events-feed.schema.ts` — "Never narrows the read", LD-1). A day
    // selection is URL state that scrolls the feed body to the `day-<ISO>`
    // anchor; teaching this double to narrow would evidence a fiction.
    const served = ALL_DAYS.filter(
      (group) => group.day >= from && group.day < to,
    );
    // The `format` facet is honoured (every fixture card is a `webinar`) so a
    // route-level test can prove the facet reached the SERVER through the URL
    // rather than being applied in the browser (019 EARS-8, #1523).
    const formats = url.searchParams.getAll("format").flatMap((v) => v.split(","));
    const days =
      formats.length === 0
        ? served
        : served
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => formats.includes(item.format)),
            }))
            .filter((group) => group.items.length > 0);
    return json(response, 200, {
      tense: "upcoming",
      from,
      to,
      days,
      totalCount: days.reduce((sum, group) => sum + group.items.length, 0),
      // «показать ещё» is offered only when a fixture day actually lies beyond
      // the served window, and the `to` it names COVERS that day — the same
      // data-aware rule the service applies (#1803). Deriving it from the mere
      // presence of a `to` would let the route look green while production
      // offered a control walking into an empty widening.
      nextTo: nextToBeyond(to),
      targeting: {
        mode: "general",
        specialtyReference: null,
        directionIds: [],
        adjacentDirectionIds: [],
      },
    });
  }

  // The shell reads these on every route; «unknown» is a valid answer for both.
  if (url.pathname === "/v1/auth/session") {
    // 019 EARS-12 needs BOTH viewers on the same fixture: the feed read is
    // viewer-independent, and the only difference the route may show is where a
    // card's «Участвовать ↗» points. So the session read answers the forwarded
    // `__Host-ds_session` cookie — present means a signed-in doctor, absent
    // means a guest — rather than 401ing unconditionally.
    const cookie = request.headers.cookie ?? "";
    if (!cookie.includes("__Host-ds_session=")) {
      return json(response, 401, { status: 401 });
    }
    return json(response, 200, {
      sub: "00000000-0000-4000-8000-000000000001",
      email: "doctor@example.test",
      roles: ["doctor"],
    });
  }
  if (url.pathname === "/v1/public/specialty-choice") {
    return json(response, 200, { specialty: null, storedIn: "none" });
  }

  return json(response, 404, { status: 404 });
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
