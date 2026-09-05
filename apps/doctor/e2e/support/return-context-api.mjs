import { createServer } from "node:http";

/**
 * The upstream double for the 021 EARS-2 return-context tier (#1538).
 *
 * `/register?returnTo=/webinars/<slug>` resolves the event SERVER-SIDE, so no browser-level
 * route interception can reach it — the read happens before the first byte of
 * HTML. The tier therefore boots the doctor app against this stand-in api,
 * exactly as the specialty-consumption tier already does with
 * `specialty-choice-api.mjs`: a test DOUBLE of an upstream service, never a
 * stub inside the product code.
 *
 * It answers the reads the surface makes — `GET /v1/public/events/:idOrSlug`
 * with a body shaped by `PublicEventPageSchema`, and (021 EARS-3, #1539)
 * `GET /v1/public/specialty-choice` with a body shaped by
 * `SpecialtyChoiceSchema` — and 404s everything else so the unresolvable-target
 * branch is exercised against a real not-found rather than a connection error.
 *
 * The specialty read is here because the LD-4 landing is also resolved on the
 * SERVER, from the forwarded `__Host-ds_specialty` cookie, and is therefore
 * just as unreachable from the browser as the event read. The double answers it
 * the way `specialty-choice-api.mjs` does — the cookie names an entry or it does
 * not — so the direct-arrival tier drives the same store the real api reads
 * rather than a tier-local switch.
 */
const port = Number(process.env.DOCTOR_FAKE_API_PORT ?? 3214);

/** The canvas's own return-context event, so the render is comparable to it. */
const EVENT = {
  id: "00000000-0000-4000-8000-0000000005f7",
  slug: "prp-pri-gonartroze",
  title: "PRP при гонартрозе: показания, протоколы, ошибки",
  school: "Школа ортобиологии",
  // 2026-08-27 19:00 Europe/Moscow (a Thursday — the canvas sub-label is
  // «27 августа · чт»), carried as the canonical UTC instant.
  startsAt: "2026-08-27T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор показаний, протоколов и типичных ошибок PRP-терапии.",
  speakers: [
    // 012 EARS-24 (#1607): after the cutover the page-speaker union has exactly
    // one arm — an `event_experts` link — so the double serves expert rows.
    {
      source: "expert",
      expertId: "00000000-0000-4000-8000-00000000e001",
      expertSlug: "anna-sokolova",
      name: "Анна Соколова",
      credentials: "к.м.н.",
      photoUrl: null,
      role: "Спикер",
    },
    {
      source: "expert",
      expertId: "00000000-0000-4000-8000-00000000e002",
      expertSlug: "mihail-vereshchagin",
      name: "Михаил Верещагин",
      credentials: "травматолог",
      photoUrl: null,
      role: "Спикер",
    },
  ],
  specialties: ["Травматология", "Ортопедия"],
  partners: [],
  // 020 EARS-2 (#1765): the required AroundEvent object. The doctor host has no
  // expert/school/community route, so every key resolves absent.
  links: { speakerPages: [] },
  state: "published",
  format: "online",
  seatsLeft: null,
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
  },
};

/**
 * The one specialty the direct-arrival tier can remember (021 EARS-3, #1539).
 * Shaped by `SpecialtyRefSchema`; its id is what the `__Host-ds_specialty`
 * cookie carries, exactly as `specialty-choice-api.mjs` models the guest store.
 */
const SPECIALTY = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "kardiologiya",
  name: "Кардиология",
  isOther: false,
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/health") return json(response, 200, { ok: true });

  if (url.pathname === "/v1/public/specialty-choice") {
    const remembered = /(?:^|;\s*)__Host-ds_specialty=([^;]*)/.exec(
      request.headers.cookie ?? "",
    );
    return json(
      response,
      200,
      remembered && decodeURIComponent(remembered[1]) === SPECIALTY.id
        ? { specialty: SPECIALTY, storedIn: "session" }
        : { specialty: null, storedIn: "none" },
    );
  }

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
