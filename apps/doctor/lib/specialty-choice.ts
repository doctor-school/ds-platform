import { SpecialtyChoiceSchema, type SpecialtyChoice } from "@ds/schemas";
import { API_BASE, forwardedSessionFrom } from "@/lib/session";

/**
 * 017 EARS-6 / EARS-7 (#1482) — the storefront half of the choose/change
 * contract (017-design §4 + §7 row «choose / change specialty»).
 *
 * ONE command, two routes, because the ACTOR decides where the choice is stored
 * (LD-2) and the actor is resolved from the request, never submitted:
 *
 *  • guest  → `POST /v1/public/specialty-choice` — the anonymous session;
 *  • doctor → `PUT  /v1/me/specialty`            — the profile link row.
 *
 * The storefront picks the route from the sign-in status the server already
 * resolved; it never sends a subject, so no client can write another doctor's
 * specialty however it is coaxed.
 *
 * Browser calls are RELATIVE (`next.config.ts` rewrites `/v1/*` onto the api on
 * this origin) and `credentials: "include"`, which is what lets the api set and
 * read the `__Host-` cookies at all — a cross-origin call could not.
 *
 * Server calls are absolute against `API_BASE` and forward the incoming
 * `Cookie` header plus the ADR-0001 §6 fingerprint headers, exactly as
 * `lib/shell-auth.ts` does. Both remembered stores travel on that header: the
 * session cookie for a doctor, `__Host-ds_specialty` for a guest.
 */
export const SPECIALTY_CHOICE_PUBLIC_PATH = "/v1/public/specialty-choice";
export const SPECIALTY_CHOICE_ME_PATH = "/v1/me/specialty";

/** Which store this visitor's choice belongs in — the LD-2 branch, resolved. */
export type SpecialtyActor = "guest" | "doctor";

/**
 * What the SERVER resolved for the first render.
 *
 * `choice: null` is «could not resolve», which is deliberately NOT the same
 * answer as `{ specialty: null }` («resolved: nothing chosen yet»). The
 * distinction is the whole point of this type: rendering the full catalog for an
 * unresolved read would show a doctor who HAS a remembered specialty the
 * question they already answered, and would then collapse under them a moment
 * later. Unresolved is handed to the client, which re-issues the same read.
 */
export interface RememberedSpecialty {
  actor: SpecialtyActor;
  choice: SpecialtyChoice | null;
  /** The SSR cascade saw an anonymous choice that the browser must consume. */
  consumeSession: boolean;
}

/** The nothing-chosen-yet answer, as the contract spells it. */
export const NO_SPECIALTY_CHOICE: SpecialtyChoice = {
  specialty: null,
  storedIn: "none",
};

function parseChoice(body: unknown): SpecialtyChoice {
  return SpecialtyChoiceSchema.parse(body);
}

/**
 * Read the remembered choice from the BROWSER.
 *
 * The degradation path of the server-side resolve, not a second mechanism: same
 * two routes, same contract, same validation. A failure resolves to «nothing
 * chosen» — the catalog is the surface that lets a visitor choose, so the safe
 * fallback is to offer it rather than to withhold it behind an error.
 */
export async function fetchSpecialtyChoice(
  actor: SpecialtyActor,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SpecialtyChoice> {
  const path =
    actor === "doctor"
      ? SPECIALTY_CHOICE_ME_PATH
      : SPECIALTY_CHOICE_PUBLIC_PATH;

  const res = await fetchImpl(path, {
    headers: { accept: "application/json" },
    credentials: "include",
    signal,
  });

  // A doctor whose session expired between the render and this read is a guest
  // now — fall through to the anonymous store rather than reporting an error
  // about an identity the visitor no longer has.
  if (res.status === 401 && actor === "doctor") {
    return fetchSpecialtyChoice("guest", fetchImpl, signal);
  }
  if (!res.ok) throw new Error(`specialty choice read failed (${res.status})`);
  return parseChoice(await res.json());
}

/**
 * `ChooseSpecialty` / `ChangeSpecialty` — the SAME command (017-design §4), sent
 * from the browser. EARS-7's «no separate save step» is this: activating an
 * entry issues the command, and the collapsed row is drawn from what the command
 * RETURNS, so the row can never name a specialty the platform did not record.
 *
 * A rejection throws. The caller's job is then to keep the catalog open and say
 * so — never to collapse anyway, which would claim a choice was remembered.
 */
export async function chooseSpecialty(
  reference: string,
  actor: SpecialtyActor,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SpecialtyChoice> {
  const doctor = actor === "doctor";
  const res = await fetchImpl(
    doctor ? SPECIALTY_CHOICE_ME_PATH : SPECIALTY_CHOICE_PUBLIC_PATH,
    {
      method: doctor ? "PUT" : "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      credentials: "include",
      body: JSON.stringify({ specialty: reference }),
      signal,
    },
  );

  if (res.status === 401 && doctor) {
    return chooseSpecialty(reference, "guest", fetchImpl, signal);
  }
  if (!res.ok) throw new Error(`specialty choice failed (${res.status})`);

  const choice = parseChoice(await res.json());
  // The command's answer must NAME what it recorded. A 200 with no specialty is
  // a contract violation, not an empty success to render a blank row from.
  if (!choice.specialty) throw new Error("specialty choice returned no entry");
  return choice;
}

/**
 * Resolve the remembered choice on the SERVER, for the first render.
 *
 * Server-resolved for EARS-6's «open every subsequent visit directly in the
 * targeted view»: a return visit must arrive already collapsed, not arrive as
 * the catalog and fold itself away once a client effect resolves.
 *
 * One upstream read in the normal case. The session cookie decides which:
 *
 *  • no session cookie → the public read; the guest store is a cookie that
 *    travels on the same header.
 *  • session cookie    → the `me` read, which is ALSO where LD-2's cascade runs
 *    (017-design §4): the api adopts an anonymous choice into an empty profile
 *    and discards it otherwise. A 401 means the session is stale — the visitor
 *    is a guest, and the public read answers for them.
 *
 * The `Set-Cookie` the api emits when the cascade consumes the session value
 * cannot be relayed from a server component, so the cookie is cleared on the
 * next browser-side call instead; the cascade is idempotent by construction
 * (after the first run there is nothing left to adopt), so a repeat is a no-op.
 *
 * An unreachable api resolves `choice: null` — «unknown», handed to the client.
 * It never throws: the shell wraps the whole storefront, and one flaky read must
 * not take the home page down (the `lib/shell-auth.ts` rule, same reasoning).
 */
export async function resolveRememberedSpecialty(
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<RememberedSpecialty> {
  const session = forwardedSessionFrom(headers);
  const cookie = headers.get("cookie") ?? "";
  const consumeSession = hasCookie(cookie, "__Host-ds_specialty");
  const upstream = {
    accept: "application/json",
    cookie,
    "user-agent": headers.get("user-agent") ?? "",
    "accept-language": headers.get("accept-language") ?? "",
  };

  const read = async (path: string) =>
    fetchImpl(`${API_BASE}${path}`, { headers: upstream, cache: "no-store" });

  try {
    if (session) {
      const res = await read(SPECIALTY_CHOICE_ME_PATH);
      if (res.ok) {
        return {
          actor: "doctor",
          choice: parseChoice(await res.json()),
          consumeSession,
        };
      }
      if (res.status !== 401) {
        return { actor: "doctor", choice: null, consumeSession };
      }
      // Stale session — fall through to the guest store below.
    }

    const res = await read(SPECIALTY_CHOICE_PUBLIC_PATH);
    if (!res.ok) return { actor: "guest", choice: null, consumeSession: false };
    return {
      actor: "guest",
      choice: parseChoice(await res.json()),
      consumeSession: false,
    };
  } catch {
    return {
      actor: session ? "doctor" : "guest",
      choice: null,
      consumeSession: session ? consumeSession : false,
    };
  }
}

function hasCookie(header: string, name: string): boolean {
  return header.split(";").some((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name;
  });
}
