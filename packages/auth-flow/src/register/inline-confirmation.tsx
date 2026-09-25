"use client";

import { VerifyDoor } from "../verify/verify-door";
import type { RegisterConfirmationProps } from "./register-door";

/**
 * 021 EARS-19 / 003 EARS-3 + EARS-25 — the post-submit state of the shared
 * registration door on a host that serves no `/verify` route (rows 51, 76).
 *
 * It is the ONE confirmation step (`VerifyDoor`, #2027 PR 1.7) mounted inline:
 * the same card, words and exits the Academy's `/verify` route renders, with
 * this host's facts as data —
 *   • the address is the one just typed, so there is no deep-link entry;
 *   • the doctor storefront's confirm command takes the reconstructed эфир
 *     (`returnTarget`) with the code and NAMES the landing (021 EARS-10), and
 *     that same target is what 005 EARS-2 completes after sign-in;
 *   • the sideways hops carry the rule S3 target (`carriedTarget`).
 *
 * A separate module rather than a mode of the door: everything past the
 * accepted command is a different rule set with a different transport.
 */
export function RegistrationConfirmation({
  config,
  email,
  landing,
  returnTarget = null,
  carriedTarget = null,
  returnContextPlate,
}: RegisterConfirmationProps) {
  return (
    <VerifyDoor
      config={config}
      email={email}
      landing={landing}
      returnTarget={returnTarget}
      completionTarget={returnTarget}
      carriedTarget={carriedTarget}
      returnContextPlate={returnContextPlate}
    />
  );
}
