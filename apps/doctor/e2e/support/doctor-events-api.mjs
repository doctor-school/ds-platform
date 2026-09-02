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
 * explicit `to` gets the default window plus a `nextTo`; a read that carries the
 * widened `to` gets the wider window, one more day group and `nextTo: null`.
 */
const port = Number(process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214);

const DEFAULT_FROM = "2026-09-01";
const DEFAULT_TO = "2026-09-15";
const WIDENED_TO = "2026-09-29";

const card = (id, startsAt, overrides = {}) => ({
  id,
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

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/health") return json(response, 200, { ok: true });

  if (url.pathname === "/v1/storefront/doctor/events") {
    const widened = url.searchParams.get("to") !== null;
    const days = widened ? [...BASE_DAYS, WIDENED_DAY] : BASE_DAYS;
    return json(response, 200, {
      tense: "upcoming",
      from: url.searchParams.get("from") ?? DEFAULT_FROM,
      to: widened ? (url.searchParams.get("to") ?? DEFAULT_TO) : DEFAULT_TO,
      days,
      totalCount: days.reduce((sum, group) => sum + group.items.length, 0),
      nextTo: widened ? null : WIDENED_TO,
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
    return json(response, 401, { status: 401 });
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
