import type { Metadata } from "next";
import { headers } from "next/headers";

import type { ConsentTier } from "@ds/schemas";
import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_COMPOSITION,
  PARTNER_DATA_EXCLUDED,
  PARTNER_DATA_SHARING_PURPOSE,
  formatPartnerDataStatement,
} from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import { RegistrationScreen } from "@/components/registration-screen";
import {
  ReturnContextPanel,
  ReturnContextPlate,
} from "@/components/return-context-card";
import { resolveDirectArrivalLanding } from "@/lib/registration-landing";
import {
  RETURN_CONTEXT_PARAM,
  resolveReturnContext,
  resolveReturnTargetPath,
} from "@/lib/return-context";
import { resolveRememberedSpecialty } from "@/lib/specialty-choice";

/**
 * 021 EARS-1 — `#d-register`, the doctor registration route (`doctor.school/register`,
 * `access: public`).
 *
 * The route belongs to the doctor storefront app but NOT to the storefront shell:
 * it lives under the chromeless `(auth)` route group (`app/(auth)/layout.tsx`), so
 * no header, navigation or footer renders on it. That is the canvas composition
 * (`design-source/auth.dc.html` `#d-register`) and the product decision behind it —
 * the door is a single-CTA surface, and the shell's onward links would lead the
 * doctor away from the form. The frame the canvas does draw — wordmark, brand
 * panel, card centred on the vertical axis — is `<AuthShell>`, the doctor-local
 * mirror of the Academy's auth frame (#1666 lifts the two into one).
 *
 * The route is what the shell's guest action cluster has been pointing at since
 * 017 shipped (`components/storefront-header.tsx` → «Регистрация»), so this slice
 * closes a link that resolved to a 404. The link crosses out of the shell, which
 * is the intended one-way step into the door.
 *
 * 021 EARS-2 (#1538) — THE RETURN CONTEXT. A doctor who pressed «Участвовать» on
 * a gated эфир arrives here carrying the CANONICAL return target in the URL
 * (`?returnTo=/webinars/<slug>` — the one vocabulary 005 EARS-2 defined, read
 * through the shared `parseReturnTarget` guard and never re-parsed locally),
 * and the route resolves it server-side against the public event read before the
 * first paint: the context is a fact about the arrival, so it must be part of the
 * document rather than something that pops in afterwards beside a form the doctor
 * is already typing into. Resolved, it fills the split's LEFT HALF through
 * `<AuthShell returnContext>` on the wide layout and stands as the background
 * plate above the form below the mobile breakpoint — the two canvas compositions
 * of variant Б, exactly one of which renders per viewport.
 *
 * Unresolvable — no param, an unknown or draft event, an api that is down — is
 * `null`, and then NOTHING is passed: the left half falls back to the brand
 * panel's value prop and the form column carries no plate. Absent from the tree,
 * never an empty frame (EARS-3, and the requirements invariant on this card).
 *
 * 021 EARS-3 (#1539) — THE DIRECT ARRIVAL. The doctor who opened the door on
 * their own is not a degraded gate arrival; they are the ordinary case. Nothing
 * stands in for the context they do not have — the left half is the brand value
 * prop, the form column carries no plate — and the one thing the surface still
 * has to decide for them is WHERE THEY LAND once registration completes, because
 * there is by construction no target to return them to. LD-4 answers it:
 * `lib/registration-landing.ts` maps what 017 remembers about this visitor onto
 * the 019 events feed (`/events`) or the storefront home (`/`), and never onto
 * the account page. The route publishes the answer as a server fact on the form
 * (`data-registration-landing`) — the same «the whole screen is a function of
 * the entry URL» read model the return context uses — and #1546 consumes it as
 * the success state's primary action. ONE ATTRIBUTE, ONE VOCABULARY: when a
 * return context DID resolve, that same attribute carries the context's safe
 * target, the shared guard's reconstruction and never the raw param (LD-3).
 *
 * 021 EARS-5 (#1541) — THE TWO-TIER CONSENT BLOCK. The route supplies the read
 * model (`CONSENT_TIERS` below) and the screen renders the controls; see that
 * constant for why the composition is assembled here rather than in the
 * component.
 *
 * The remaining envelope slots are still unsupplied, which is the correct state
 * of this slice and not an omission: the attribution line (#1544) and the points
 * promise (#1545) are separate EARS handlers under the honest-empty rule.
 * `RegistrationScreen` enforces it; passing nothing is how the enforcement is
 * exercised.
 *
 * The route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking the full build: the form composition is real, but the
 * door does not open yet — the submit is inert pending the EARS-19 bot-protection
 * client half and the EARS-4/5 consent precondition (see the component header).
 *
 * ONE `headers()` READ, AND ONLY ON A DIRECT ARRIVAL. The rendered screen is
 * not per-visitor — the event read behind the return context is `access:
 * public` and identical for every caller — but the LD-4 landing IS: it depends
 * on the specialty 017 remembers for whoever is at the door, which lives in
 * their session cookie or their profile. So the request headers are read
 * exactly once, on the branch that needs them, and are forwarded through the
 * one shared resolver (`lib/specialty-choice.ts` → `resolveRememberedSpecialty`,
 * the same call `app/(storefront)/page.tsx` makes) rather than inspected here.
 * The route is therefore dynamic; a gate arrival takes the branch that reads no
 * headers at all.
 */
/**
 * 021 EARS-5 — the F-021-1 «вариант Б» read model, assembled on the server from
 * the API-contract SSOT and handed to the screen as data.
 *
 * It is built HERE and not inside the component for the reason design §4 gives:
 * the statement the doctor reads and the purpose that is recorded must come
 * from one source, so the composition arrays travel with the statement they
 * produced. A component that hardcoded the sentence would let the two drift the
 * moment the shared composition changes.
 *
 * Exactly two tiers, in their rendered order: the access conditions that stand
 * above the submit, and the optional opt-in that stands below it. The
 * medical-worker declaration is an access condition too (design §4's table) but
 * is not listed here — it is a precondition of the command the screen owns and
 * is rendered unconditionally, so putting it in this list would give it two
 * homes.
 */
const CONSENT_TIERS: readonly ConsentTier[] = [
  {
    tier: "access-conditions",
    items: [
      {
        purpose: PARTNER_DATA_SHARING_PURPOSE,
        required: true,
        statement: formatPartnerDataStatement(),
        dataComposition: [...PARTNER_DATA_COMPOSITION],
        excluded: [...PARTNER_DATA_EXCLUDED],
      },
    ],
  },
  {
    tier: "marketing",
    items: [
      {
        purpose: MARKETING_COMMUNICATIONS_PURPOSE,
        required: false,
        // Canvas copy (`#d-register`, «согласия · вариант Б»). No composition
        // to declare: the opt-in shares nothing, it subscribes.
        statement: "Хочу получать письма о новых школах и событиях",
      },
    ],
  },
];

export const metadata: Metadata = {
  title: "Регистрация — Doctor.School",
  description:
    "Регистрация врача на Doctor.School: рабочая почта, пароль и промокод, если он есть. Документы на входе не нужны.",
};

export default async function DoctorRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — a malformed return context degrades to no context,
  // it never breaks the door.
  const returnTo = Array.isArray(raw) ? raw[0] : raw;
  // The guard's reconstruction of the arrival's target — the ONE vocabulary,
  // resolved before the read so the same value serves the context and the
  // landing, and the raw param serves neither.
  const safeTarget = resolveReturnTargetPath(returnTo);
  const returnEvent = safeTarget
    ? await resolveReturnContext(safeTarget)
    : null;

  // EARS-3 / LD-4 — where this arrival lands after confirmation. A gate arrival
  // lands back on the эфир it came from; a direct arrival lands where 017's
  // remembered specialty says, which is the only per-visitor fact on the route
  // and the only reason it reads `headers()` (see the module header).
  const landing =
    safeTarget && returnEvent
      ? safeTarget
      : resolveDirectArrivalLanding(
          await resolveRememberedSpecialty(await headers()),
        );

  return (
    <AuthShell
      returnContext={
        returnEvent ? <ReturnContextPanel event={returnEvent} /> : undefined
      }
    >
      <RegistrationScreen
        landing={landing}
        consentTiers={CONSENT_TIERS}
        returnContext={
          returnEvent ? <ReturnContextPlate event={returnEvent} /> : undefined
        }
      />
    </AuthShell>
  );
}
