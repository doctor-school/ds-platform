// The upstream double of the sign-in host's CI tier (#3170, #3172): answers
// the API's `GET /v1/sign-in-host/entry` with the contract's render answer
// (`SignInHostEntryResponseSchema`), so the host renders each storefront's
// real `@ds/auth-flow` door with no api, IdP or DB.
//
// An auth request id names the answer (see `support/sign-in-door.ts`):
// `<storefront>-<door>[-code][-handoff][-at-<event slug>]` — the door and the
// EARS-71 intent the storefront entry would have recorded. Every other auth
// request is the API's redirect answer for an unknown one.
//
// Beside the entry it answers what a mounted door reads on the SERVER through
// the host's `API_PROXY_TARGET` (the return-context card's public event read,
// the arrival landing's specialty read, the session read — the host origin
// holds no storefront session, so it is always the anonymous 401), shaped by
// the `@ds/schemas` contracts the same way the doctor storefront tier's
// `apps/doctor/e2e/support/return-context-api.mjs` answers them, and the host
// form commands a spec drives without intercepting (`/v1/sign-in-host/…`):
// each finished credential step answers `SignInHostStepResponseSchema`'s
// redirect to `/__idp/callback` here, the IdP's callback in production.
import { createServer } from "node:http";

const PORT = Number(process.env.LOGIN_FAKE_API_PORT ?? 3216);
const IDP_CALLBACK = `http://127.0.0.1:${PORT}/__idp/callback`;

/** The ids that predate the generic grammar, answered exactly as before. */
const RENDERS = {
  "doctor-login": { storefront: "doctor", door: "login" },
  "doctor-register": { storefront: "doctor", door: "register" },
  "academy-login": { storefront: "academy", door: "login" },
  "academy-register": { storefront: "academy", door: "register" },
  // #3172 — the reset door carries its EARS-71 intent (an empty one).
  "doctor-reset": {
    storefront: "doctor",
    door: "reset",
    intent: { handoff: false },
  },
  "academy-reset": {
    storefront: "academy",
    door: "reset",
    intent: { handoff: false },
  },
};

const GRAMMAR =
  /^(doctor|academy)-(login|register|reset)(-code)?(-handoff)?(?:-at-([a-z0-9-]+))?$/;

function renderFor(authRequest) {
  if (RENDERS[authRequest]) return RENDERS[authRequest];
  const m = GRAMMAR.exec(authRequest);
  if (!m) return null;
  const [, storefront, door, code, handoff, eventTarget] = m;
  return {
    storefront,
    door,
    intent: {
      ...(code ? { method: "code" } : {}),
      ...(eventTarget ? { eventTarget } : {}),
      handoff: Boolean(handoff),
    },
  };
}

/**
 * The doctor storefront's fixture эфиры (`PublicEventPageSchema`), the same
 * rows `apps/doctor/e2e/support/return-context-api.mjs` serves: the canvas's
 * return-context event, an ended one, a live one and a registered one.
 */
const EVENT = {
  id: "00000000-0000-4000-8000-0000000005f7",
  slug: "prp-pri-gonartroze",
  title: "PRP при гонартрозе: показания, протоколы, ошибки",
  school: "Школа ортобиологии",
  startsAt: "2026-08-27T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор показаний, протоколов и типичных ошибок PRP-терапии.",
  speakers: [
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
  links: { speakerPages: [] },
  nmo: false,
  pulCost: 0,
  state: "published",
  format: "online",
  seatsLeft: null,
  signUps: null,
  viewers: null,
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
    durationSec: null,
  },
};

const EVENTS = [
  EVENT,
  {
    ...EVENT,
    id: "00000000-0000-4000-8000-0000000005f8",
    slug: "ended-vedenie-hronicheskoy-boli",
    title: "Ведение хронической боли: разбор клинических случаев",
    startsAt: "2026-05-14T16:00:00.000Z",
    state: "ended",
  },
  {
    ...EVENT,
    id: "00000000-0000-4000-8000-0000000005f9",
    slug: "live-nevrologiya-praktikum",
    title: "Неврология в практике терапевта: разбор случаев",
    startsAt: "2026-05-20T09:00:00.000Z",
    state: "live",
  },
  {
    ...EVENT,
    id: "00000000-0000-4000-8000-0000000005fa",
    slug: "registered-revmatologiya-obzor",
    title: "Ревматология: обзор новых клинических рекомендаций",
    startsAt: "2026-09-24T16:00:00.000Z",
    state: "published",
  },
];

/** The one specialty a guest can remember (`SpecialtyRefSchema`). */
const SPECIALTY = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "kardiologiya",
  name: "Кардиология",
  isOther: false,
};

/** The one code the doctor code command refuses (003 EARS-41). */
const REFUSED_CODE = "000000";

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req, done) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    try {
      done(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    } catch {
      done({});
    }
  });
}

const redirect = (res) =>
  json(res, 200, { status: "redirect", url: IDP_CALLBACK });

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });

  // A storefront page the person signs in FROM (#3172 history): where Back
  // from the returned page must land.
  if (url.pathname.startsWith("/__storefront/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><title>Storefront page</title>");
  }

  if (url.pathname === "/__idp/callback") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><title>IdP callback</title>");
  }

  if (url.pathname === "/v1/sign-in-host/entry") {
    const authRequest = url.searchParams.get("authRequest") ?? "";
    const render = renderFor(authRequest);
    if (!render) {
      return json(res, 200, {
        action: "redirect",
        url: "http://127.0.0.1:3004/login",
      });
    }
    return json(
      res,
      200,
      { action: "render", ...render, authRequest, csrf: "csrf-axe" },
      {
        "set-cookie":
          "__Host-ds_login_form=axe; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400",
      },
    );
  }

  if (req.method === "POST") {
    if (url.pathname === "/v1/sign-in-host/storefront/doctor/register") {
      return readJson(req, () =>
        json(res, 200, { status: "pending_verification" }),
      );
    }
    if (url.pathname === "/v1/sign-in-host/verify/resend") {
      return readJson(req, () =>
        json(res, 200, { status: "resend_requested" }),
      );
    }
    if (url.pathname === "/v1/sign-in-host/storefront/doctor/verify") {
      return readJson(req, (body) =>
        body?.code === REFUSED_CODE
          ? json(res, 400, {
              statusCode: 400,
              error: "Bad Request",
              message: "the request could not be completed",
            })
          : redirect(res),
      );
    }
    if (url.pathname === "/v1/sign-in-host/login") {
      return readJson(req, () => redirect(res));
    }
  }

  if (url.pathname === "/v1/auth/session") {
    return json(res, 401, { status: 401, message: "unauthorized" });
  }

  if (url.pathname === "/v1/public/specialty-choice") {
    const remembered = /(?:^|;\s*)__Host-ds_specialty=([^;]*)/.exec(
      req.headers.cookie ?? "",
    );
    return json(
      res,
      200,
      remembered && decodeURIComponent(remembered[1]) === SPECIALTY.id
        ? { specialty: SPECIALTY, storedIn: "session" }
        : { specialty: null, storedIn: "none" },
    );
  }

  const event = /^\/v1\/public\/events\/([^/]+)$/.exec(url.pathname);
  if (event) {
    const key = decodeURIComponent(event[1]);
    const found = EVENTS.find((e) => e.slug === key || e.id === key);
    if (found) return json(res, 200, found);
    return json(res, 404, { status: 404, message: "event not found" });
  }

  json(res, 404, { message: "not in the sign-in host double" });
}).listen(PORT, "127.0.0.1");
