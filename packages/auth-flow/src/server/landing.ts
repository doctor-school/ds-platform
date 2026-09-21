import { SpecialtyChoiceSchema, type SpecialtyChoice } from "@ds/schemas";

import type { AuthFlowHostConfig } from "../host-config";
import {
  forwardedHeaders,
  forwardedSessionFrom,
  serverApiBase,
} from "./session";

/**
 * 021 EARS-3 (#1539) / 017 EARS-6 - WHERE A DIRECT ARRIVAL LANDS, as a package
 * server rule over the host config (#2027 PR 1.5; was the doctor host
 * lib/registration-landing.ts + `resolveRememberedSpecialty` in
 * lib/specialty-choice.ts).
 *
 * THE LANDING IS A DECISION ABOUT THE VISITOR, NOT A CONSTANT - on a host whose
 * config says `landing.specialtyAware`. If 017 already remembers which specialty
 * this visitor reads for (`SpecialtyChosen`, the LD-2 cascade), they land on the
 * feed the config names (`specialtyFeed`); otherwise on `afterLogin`, the surface
 * where the specialty question is asked. An UNRESOLVED read (`choice: null`)
 * lands exactly like a resolved «nothing chosen»: both mean «we do not know».
 * A host that is not specialty-aware lands on `afterLogin` and reads nothing.
 *
 * THE ACCOUNT PAGE IS NEVER A DIRECT-ARRIVAL LANDING (LD-4 owner decision): the
 * only destinations are the two config paths.
 *
 * WHY THE PACKAGE READS THE SPECIALTY. A `mounted` route file may not read
 * anything, so the remembered-specialty read is a package server helper; the
 * host config NAMES the two read endpoints and the deferred-consumption header
 * as strings (`landing.specialtyEndpoints`) - data, never a callback.
 */

type LandingHost = Pick<AuthFlowHostConfig, "landing">;

/** A landing config that is specialty-aware (the doctor storefront). */
export type SpecialtyAwareLanding = Extract<
  AuthFlowHostConfig["landing"],
  { specialtyAware: true }
>;

/** Which store this visitor choice belongs in - the LD-2 branch, resolved. */
export type SpecialtyActor = "guest" | "doctor";

/**
 * What the SERVER resolved for the first render. `choice: null` is «could not
 * resolve», deliberately NOT the same answer as `{ specialty: null }` («resolved:
 * nothing chosen yet»).
 */
export interface RememberedSpecialty {
  actor: SpecialtyActor;
  choice: SpecialtyChoice | null;
}

/** The nothing-chosen-yet answer, as the contract spells it. */
export const NO_SPECIALTY_CHOICE: SpecialtyChoice = {
  specialty: null,
  storedIn: "none",
};

/**
 * Resolve the remembered choice on the SERVER, for the first render (017 EARS-6:
 * a return visit arrives already in the targeted view).
 *
 *  - no session cookie -> the config `guest` read; the guest store is a cookie
 *    that travels on the same header.
 *  - session cookie    -> the config `signedIn` read, which is also where
 *    LD-2 cascade runs. A 401 means the session is stale - the visitor is a
 *    guest, and the guest read answers for them.
 *
 * An unreachable api resolves `choice: null` - «unknown». It never throws: one
 * flaky read must not take a page down. When the consumption was deferred (the
 * config header is `1`), a failed signed-in read resolves «nothing chosen»
 * rather than a lossy browser adoption (017 EARS-6.25).
 */
export async function resolveRememberedSpecialty(
  host: { readonly landing: SpecialtyAwareLanding },
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<RememberedSpecialty> {
  const endpoints = host.landing.specialtyEndpoints;
  const session = forwardedSessionFrom(headers);
  const consumptionDeferred =
    headers.get(endpoints.consumptionDeferredHeader) === "1";
  // The RAW cookie header rides both reads: the guest store lives in the
  // specialty cookie, which `forwardedSessionFrom` does not treat as a session.
  const upstream = forwardedHeaders({
    ...session,
    cookie: headers.get("cookie") ?? "",
  });

  const read = async (path: string) =>
    fetchImpl(`${serverApiBase()}${path}`, {
      headers: upstream,
      cache: "no-store",
    });

  try {
    if (session.cookie) {
      const res = await read(endpoints.signedIn);
      if (res.ok) {
        return {
          actor: "doctor",
          choice: SpecialtyChoiceSchema.parse(await res.json()),
        };
      }
      if (res.status !== 401) return { actor: "doctor", choice: null };
      // Stale session - fall through to the guest store below.
    }

    const res = await read(endpoints.guest);
    if (!res.ok) return { actor: "guest", choice: null };
    return {
      actor: "guest",
      choice: SpecialtyChoiceSchema.parse(await res.json()),
    };
  } catch {
    return {
      actor: session.cookie ? "doctor" : "guest",
      choice:
        session.cookie && consumptionDeferred ? NO_SPECIALTY_CHOICE : null,
    };
  }
}

/**
 * LD-4, as a pure function of the config and what 017 remembers. Takes the
 * already-resolved `RememberedSpecialty` so a caller that needs the read for
 * another purpose pays for it once.
 */
export function resolveDirectArrivalLanding(
  host: LandingHost,
  remembered: RememberedSpecialty,
): string {
  const { landing } = host;
  if (!landing.specialtyAware) return landing.afterLogin;
  // `choice: null` is «unresolved», `choice.specialty: null` is «resolved:
  // nothing chosen». Different facts, same landing.
  return remembered.choice?.specialty
    ? landing.specialtyFeed
    : landing.afterLogin;
}

/**
 * The direct-arrival landing end to end: read the remembered specialty only on a
 * specialty-aware host, then apply LD-4.
 */
export async function resolveArrivalLanding(
  host: LandingHost,
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { landing } = host;
  if (!landing.specialtyAware) return landing.afterLogin;
  return resolveDirectArrivalLanding(
    host,
    await resolveRememberedSpecialty({ landing }, headers, fetchImpl),
  );
}
