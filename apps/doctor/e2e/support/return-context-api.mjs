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
 * The session read (`GET /v1/auth/session`, #1955) is here for the third time
 * for the same reason: `/login` decides whether the visitor already holds a
 * session on the SERVER, through `lib/shell-auth.ts`, and answers a signed-in
 * doctor with a redirect instead of the door. The double answers it the way the
 * api does — the forwarded `__Host-ds_session` cookie names a live session or it
 * does not — so the tier drives the real server read rather than a switch in
 * product code.
 *
 * `POST /v1/auth/login` (021 EARS-15, #1996) is here because the confirmed
 * doctor is SIGNED IN by replaying the real 003 EARS-5 login: the confirm route
 * mints no session, the client replays the login through this same proxy, and
 * the api answers by setting `__Host-ds_session`. The double answers it the same
 * way — the one live session value below — so the header of the page the doctor
 * lands on is decided by the real server read of a real cookie, not by a switch
 * in the tier.
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
  // 020 EARS-4 (#1766): the public page schema is `.strict()` and requires both.
  nmo: false,
  pulCost: 0,
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

/**
 * The guest participation policy for the fixture event (020 LD-2). The double
 * serves the SERVER-RESOLVED object the page renders; it never lets the host
 * branch on lifecycle or registration, which is the whole point of the contract.
 */
/**
 * The one password this double REFUSES at `POST /v1/auth/login` (021 EARS-15).
 * Kept in step by name with the same constant in `e2e/register-return.spec.ts`,
 * which is the only caller that sends it — a spec importing from this module
 * would pull the whole server into the Playwright type graph.
 */
const REFUSED_PASSWORD = "the second password the idp never took";

/**
 * The register policy the api's `participation-cta.resolver` builds for a
 * publicly reachable, REGISTRABLE event (`published`/`live`, 005 design §5): the
 * hand-off to `/register` carrying THIS host's event path as the return target.
 * Identical for a guest and for a signed-in-but-unregistered doctor — one policy
 * (020 LD-2); who gets the in-place one-tap instead of the hand-off is the
 * host's decision, taken from the registration read below.
 */
function registerCta(slug) {
  return {
    action: "register",
    label: "Участвовать",
    href: `/register?returnTo=${encodeURIComponent(`/events/${slug}`)}`,
    reason: null,
    presenceCount: null,
  };
}

/**
 * The `__Host-ds_session` value this double accepts as a live doctor session
 * (#1955). Exported through the spec by literal agreement rather than an import:
 * the spec sets the cookie, this answers it, and the app in between does the
 * real read.
 */
const SESSION_VALUE = "e2e-signed-in-doctor";

/**
 * The эфир that ALREADY ENDED (021 EARS-10 / LD-8, #1546). Carried through the
 * confirmation, it is the degraded branch: the page still exists and is still
 * readable, so the honest landing is that page — with the success state saying
 * WHY it is no longer a return. Same shape as the live fixture; only the
 * lifecycle state, the slug and the instant differ.
 */
const ENDED_EVENT = {
  ...EVENT,
  id: "00000000-0000-4000-8000-0000000005f8",
  slug: "ended-vedenie-hronicheskoy-boli",
  title: "Ведение хронической боли: разбор клинических случаев",
  startsAt: "2026-05-14T16:00:00.000Z",
  state: "ended",
};

/**
 * 020 EARS-20 (#1777) — the эфир that is ON AIR right now. The parity sweep has
 * to drive the LIVE phase on both hosts, and «live» is a SERVER fact
 * (`PublicEventStateSchema`, `state: "live"`) that no browser-side switch can
 * fabricate: the hero status plate and the room-entry policy are both resolved
 * from it upstream of the first byte of HTML. `startsAt` sits in the past by a
 * margin larger than `durationMin`, so the countdown mapper has nothing to
 * count and the plate falls to the bare «В эфире» word.
 */
const LIVE_EVENT = {
  ...EVENT,
  id: "00000000-0000-4000-8000-0000000005f9",
  slug: "live-nevrologiya-praktikum",
  title: "Неврология в практике терапевта: разбор случаев",
  startsAt: "2026-05-20T09:00:00.000Z",
  state: "live",
};

/**
 * 020 EARS-20 (#1777) — the upcoming эфир this tier's ONE doctor is ALREADY
 * registered for. It is a separate fixture rather than a flag on {@link EVENT}
 * because the registered arm and the not-yet-registered arm of the matrix must
 * both be drivable in the same run, and the upstream keys registration by event,
 * not by a request parameter.
 */
const REGISTERED_EVENT = {
  ...EVENT,
  id: "00000000-0000-4000-8000-0000000005fa",
  slug: "registered-revmatologiya-obzor",
  title: "Ревматология: обзор новых клинических рекомендаций",
  startsAt: "2026-09-24T16:00:00.000Z",
  state: "published",
};

/** Every эфир this double answers for, by slug and by id. */
const EVENTS = [EVENT, ENDED_EVENT, LIVE_EVENT, REGISTERED_EVENT];

/**
 * The slugs this tier's ONE live doctor holds a registration for (005 EARS-4).
 * A read for any other event answers `{ registered: false }` — the honest
 * «this doctor is signed in and is not registered» fact, which is what makes the
 * host render the one-tap command instead of the `/register` hand-off.
 */
const REGISTERED_SLUGS = new Set([REGISTERED_EVENT.slug, LIVE_EVENT.slug]);

/**
 * The participation policy, resolved the way the api resolves it (020 LD-2):
 * from the event's lifecycle state and the CALLER's registration, never from
 * anything the host could compute. The four answers this tier needs:
 *
 *   • registrable × not registered → `register` (guest and signed-in alike);
 *   • `published` × registered   → `registered`, no target — the card states
 *     «Вы записаны» in words and carries no control (020 EARS-6);
 *   • `live` × registered        → `enter-room` with THIS host's room route
 *     (#1722) — the «Войти в эфир» control (020 EARS-7);
 *   • not registrable (`ended`) → `unavailable`, no target, the reason in plain
 *     words — zero participation controls (020 EARS-4).
 */
function participationFor(event, registered) {
  if (event.state === "ended") {
    return {
      action: "unavailable",
      label: "Регистрация закрыта",
      href: null,
      reason: "Эфир завершён — регистрация больше не открыта.",
      presenceCount: null,
    };
  }
  if (!registered) return registerCta(event.slug);
  if (event.state === "live") {
    return {
      action: "enter-room",
      label: "Войти в эфир",
      href: `/events/${event.slug}/room`,
      reason: null,
      presenceCount: null,
    };
  }
  return {
    action: "registered",
    label: "Вы записаны",
    href: null,
    reason: null,
    presenceCount: null,
  };
}

function findEvent(key) {
  return EVENTS.find((event) => event.slug === key || event.id === key) ?? null;
}

/**
 * 021 EARS-10 (#1546) — the layer-1 landing table, answered by the target the
 * client carried.
 *
 * The double reproduces the SERVER's decision, never the client's: the browser
 * tier has to see a `return`, a degraded `landing` with a reason and a bare
 * `landing` come back from the wire, because the whole point of the clause is
 * that the client re-derives none of them.
 */
function confirmAnswer(returnTo) {
  const base = {
    status: "verified",
    credited: null,
    profileCompletion: null,
    secondaryAction: { kind: "cabinet", href: "/account" },
  };
  if (returnTo === `/events/${EVENT.slug}`) {
    return { ...base, primaryAction: { kind: "return", href: returnTo } };
  }
  if (returnTo === `/events/${ENDED_EVENT.slug}`) {
    return {
      ...base,
      primaryAction: { kind: "landing", href: returnTo, reason: "ended" },
    };
  }
  // Absent, unparseable or hostile — one answer, exactly as the guard treats
  // them: nothing was carried, so the landing is the api's own default.
  return { ...base, primaryAction: { kind: "landing", href: "/events" } };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  // The `double` marker is a CONTRACT, not decoration (#1996 review): the
  // one-off evidence driver drives a real registration, so it refuses to start
  // until it has read this marker off its upstream. The owner's real api on
  // :3000 answers `/health` without it, which is exactly the mistake that has
  // to be impossible rather than merely documented.
  if (url.pathname === "/health")
    return json(response, 200, { ok: true, double: "return-context-api" });

  // The three write commands the registration journey makes (021 EARS-10,
  // #1546). The register and resend answers are the enumeration-safe constants
  // the contract declares; the confirm answer is the landing table above.
  if (request.method === "POST") {
    if (url.pathname === "/v1/storefront/doctor/register") {
      return readJson(request, () =>
        json(response, 200, { status: "pending_verification" }),
      );
    }
    if (url.pathname === "/v1/auth/verify/resend") {
      return readJson(request, () =>
        json(response, 200, { status: "resend_requested" }),
      );
    }
    // 003 EARS-5 / 021 EARS-15 (#1996) — the replayed sign-in. The double owns
    // exactly ONE credential verdict, and it is the one the journey turns on:
    // `REFUSED_PASSWORD` gets the generic 401 the 003 engine answers when the
    // held credential is not the one the IdP holds (the doctor re-registered
    // with a second password — 003 EARS-16 answers a repeat registration
    // identically, so the client cannot know). Every other password is accepted,
    // because this tier asserts the session that follows a successful sign-in,
    // not the engine's verdict. The success answer is the api's own — a
    // token-free body plus the `__Host-ds_session` cookie the BFF sets, which
    // `/v1/auth/session` above then recognises as this tier's live doctor.
    if (url.pathname === "/v1/auth/login") {
      return readJson(request, (body) =>
        body?.password === REFUSED_PASSWORD
          ? // 003 EARS-16 — one generic answer, no enumeration oracle.
            json(response, 401, {
              statusCode: 401,
              error: "Unauthorized",
              message: "invalid_credentials",
            })
          : json(
              response,
              200,
              { status: "authenticated" },
              {
                "set-cookie": `__Host-ds_session=${SESSION_VALUE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
              },
            ),
      );
    }
    if (url.pathname === "/v1/storefront/doctor/confirm") {
      return readJson(request, (body) =>
        json(response, 200, confirmAnswer(body.returnTo)),
      );
    }
  }

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

  // 005 EARS-4 (#1777) — the per-caller registration read the shared unit makes
  // SERVER-side (`packages/events-storefront/src/server/registration-state.ts`),
  // forwarding the session cookie. It is authenticated: no live session → the
  // api's own 401, which the unit collapses to `null` and the page renders as a
  // guest. That collapse is exactly what tells the host whether to mount the
  // one-tap command or keep the server-resolved `/register` hand-off, so the
  // double has to answer it rather than let a browser switch decide.
  const registration = /^\/v1\/events\/([^/]+)\/registration$/.exec(url.pathname);
  if (registration && request.method === "GET") {
    if (!isLiveSession(request)) {
      return json(response, 401, { status: 401, message: "unauthorized" });
    }
    const found = findEvent(decodeURIComponent(registration[1]));
    if (!found) {
      return json(response, 404, { status: 404, message: "event not found" });
    }
    return REGISTERED_SLUGS.has(found.slug)
      ? json(response, 200, {
          registered: true,
          registeredAt: "2026-09-01T10:00:00.000Z",
        })
      : json(response, 200, { registered: false });
  }

  if (url.pathname === "/v1/auth/session") {
    // The one live session this tier knows. Any other cookie value is an
    // expired or forged session and gets the api's own 401, which
    // `lib/shell-auth.ts` reads as `guest`.
    const session = /(?:^|;\s*)__Host-ds_session=([^;]*)/.exec(
      request.headers.cookie ?? "",
    );
    if (session && decodeURIComponent(session[1]) === SESSION_VALUE) {
      return json(response, 200, {
        sub: "00000000-0000-4000-8000-0000000000d1",
        roles: ["doctor_guest"],
        mfa: false,
      });
    }
    return json(response, 401, { status: 401, message: "unauthorized" });
  }

  // 021 #1945 — the LANDING the tier now follows. After sign-in the doctor is
  // taken to this host's own `/events/<slug>` page (020-design §1), which reads
  // the DOCTOR storefront envelope on the server — so the double has to answer
  // that pair too, or the landing would render a 404 and the tier would call a
  // broken redirect green. The page body is the same `EventPageView` the public
  // read serves (`PublicEventPageSchema === EventPageViewSchema`), so the one
  // fixture answers both envelopes rather than drifting into two.
  const participation =
    /^\/v1\/storefront\/doctor\/events\/([^/]+)\/participation$/.exec(
      url.pathname,
    );
  if (participation) {
    const found = findEvent(decodeURIComponent(participation[1]));
    if (!found) {
      return json(response, 404, { status: 404, message: "event not found" });
    }
    return json(
      response,
      200,
      participationFor(
        found,
        isLiveSession(request) && REGISTERED_SLUGS.has(found.slug),
      ),
    );
  }

  const storefront = /^\/v1\/storefront\/doctor\/events\/([^/]+)$/.exec(
    url.pathname,
  );
  if (storefront) {
    const found = findEvent(decodeURIComponent(storefront[1]));
    if (found) return json(response, 200, found);
    return json(response, 404, { status: 404, message: "event not found" });
  }

  const match = /^\/v1\/public\/events\/([^/]+)$/.exec(url.pathname);
  if (match) {
    const found = findEvent(decodeURIComponent(match[1]));
    if (found) return json(response, 200, found);
    return json(response, 404, { status: 404, message: "event not found" });
  }

  return json(response, 404, { status: 404 });
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

/**
 * Does this request carry the ONE live doctor session this tier knows? The same
 * cookie read `/v1/auth/session` does, shared so the participation and
 * registration answers cannot drift from the session answer.
 */
function isLiveSession(request) {
  const session = /(?:^|;\s*)__Host-ds_session=([^;]*)/.exec(
    request.headers.cookie ?? "",
  );
  return !!session && decodeURIComponent(session[1]) === SESSION_VALUE;
}

/** Collect a JSON request body, then answer. `{}` for anything unparseable. */
function readJson(request, done) {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    try {
      done(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    } catch {
      done({});
    }
  });
}

function json(response, status, body, headers) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
