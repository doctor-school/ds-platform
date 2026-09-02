import { createServer } from "node:http";

/**
 * The upstream double for the 021 EARS-2 return-context tier (#1538).
 *
 * `/register?from=<slug>` resolves the event SERVER-SIDE, so no browser-level
 * route interception can reach it — the read happens before the first byte of
 * HTML. The tier therefore boots the doctor app against this stand-in api,
 * exactly as the specialty-consumption tier already does with
 * `specialty-choice-api.mjs`: a test DOUBLE of an upstream service, never a
 * stub inside the product code.
 *
 * It answers the ONE read the surface makes — `GET /v1/public/events/:idOrSlug`
 * — with a body shaped by `PublicEventPageSchema`, and 404s everything else so
 * the unresolvable-`from` branch is exercised against a real not-found rather
 * than a connection error.
 */
const port = Number(process.env.DOCTOR_FAKE_API_PORT ?? 3214);

/** The canvas's own return-context event, so the render is comparable to it. */
const EVENT = {
  id: "00000000-0000-4000-8000-0000000005f7",
  slug: "prp-pri-gonartroze",
  title: "PRP при гонартрозе: показания, протоколы, ошибки",
  school: "Школа ортобиологии",
  // 2026-08-28 19:00 Europe/Moscow, carried as the canonical UTC instant.
  startsAt: "2026-08-28T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор показаний, протоколов и типичных ошибок PRP-терапии.",
  speakers: [
    { source: "legacy", name: "Анна Соколова", credentials: "к.м.н." },
    { source: "legacy", name: "Михаил Верещагин", credentials: "травматолог" },
  ],
  specialties: ["Травматология", "Ортопедия"],
  partners: [],
  state: "published",
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
  },
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/health") return json(response, 200, { ok: true });

  const match = /^\/v1\/public\/events\/([^/]+)$/.exec(url.pathname);
  if (match) {
    const key = decodeURIComponent(match[1]);
    if (key === EVENT.slug || key === EVENT.id) {
      return json(response, 200, EVENT);
    }
    return json(response, 404, { status: 404, message: "event not found" });
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
