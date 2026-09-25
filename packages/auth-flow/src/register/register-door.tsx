"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
  type ConsentAcceptance,
  type ConsentItem,
} from "@ds/schemas";
import {
  botProtectionFailureMessage,
  BotProtectionField,
  clearPendingRegistration,
  isBotProtectionRejected,
  isBotProtectionRequired,
  RegisterCard,
  setPendingRegistration,
  useBotProtectedAction,
  type RegisterCardConsentItem,
  type RegisterCardCopy,
  type RegisterCardProps,
  type RegisterCardTestIds,
  type RegisterCardValues,
} from "@ds/design-system/blocks";
import { Link as DsLink } from "@ds/design-system/link";

import { resolveAuthFlowCopy } from "../copy";
import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { authErrorMessage } from "../errors";
import { registerFieldHint, registerFieldRules } from "../fields";
import type {
  AuthFlowConsentsConfig,
  AuthFlowConsentsCopy,
  AuthFlowHostConfig,
} from "../host-config";
import { withReturnTarget } from "../return-target-href";
import { RegistrationConfirmation } from "./inline-confirmation";
import { RegisterGlyph } from "./register-glyph";

/**
 * The ONE client registration door of the platform (#2027 PR 1.6, gate rows
 * 9, 47-64).
 *
 * Both storefronts register through THIS component; what differs between them is
 * data — `AuthFlowHostConfig` — and never a branch. The card frame, the consent
 * groups and the submit group are the design-system `<RegisterCard>` block
 * (ADR-0013 A1); what the door adds is the
 * composition the two hosts used to own twice: the live BFF command, the
 * bot-protection retry-once orchestration, the EARS-16 outcome mapping, the
 * consent READ MODEL → recorded acceptances projection, the held credential for
 * the step after the submit, and the row-51 fork out of an accepted command.
 *
 * Row 51 is the one structural fork, and it is a HOST FACT rather than a branch:
 * a host that serves a `/verify` route of its own hands the address to it, and a
 * host that serves none confirms on the door itself.
 */
export type RegisterDoorProps = {
  /** Everything that differs between the two storefronts (rows 9, 47-64). */
  config: AuthFlowHostConfig;
  /**
   * Where a visitor with NO carried target lands — resolved on the SERVER by the
   * mount, because a host may decide it per visitor. Published on the `<form>` as
   * `data-registration-landing` so the decision is readable rather than recomputed
   * (021 EARS-3 / LD-3).
   */
  landing: string;
  /**
   * The RAW carried `returnTo` param, for the footer LINKS and the `/verify` hop
   * only. Guarded by the same-origin rule at each consumption point, so a hostile
   * value is never propagated onward.
   */
  returnTo?: string | null;
  /** The mount's guard-reconstructed completion target, in THIS host's vocabulary. */
  returnTarget?: string | null;
  /** The rule S3 carry vocabulary — what the confirmation step hands onward. */
  carriedTarget?: string | null;
  /** The gate context the visitor arrived from — the plate above the card (021 EARS-2). */
  returnContextPlate?: ReactNode;
};

/**
 * The confirmation step's contract (rows 51, 76) — a host with no `/verify`
 * route confirms the address on the door itself.
 */
export type RegisterConfirmationProps = {
  config: AuthFlowHostConfig;
  email: string;
  landing: string;
  returnTarget?: string | null;
  carriedTarget?: string | null;
  /** 021 EARS-2 — the arrival plate the form stood under; the step keeps it. */
  returnContextPlate?: ReactNode;
};

/** The declaration's own key: a DECLARATION is not a consent purpose (021 EARS-4). */
const MEDWORKER_ID = "medworker";

/** The canonical `data-testid` map, one on both hosts (the doctor's shipped set). */
const TEST_IDS: RegisterCardTestIds = {
  root: "registration-screen",
  card: "registration-form-card",
  returnContext: "registration-return-context",
  attribution: "registration-attribution",
  form: "registration-form",
  email: "register-email",
  password: "register-password",
  promo: "register-promo",
  submit: "register-submit",
  challengeError: "register-captcha-error",
  commandError: "register-command-error",
  accessGroup: "registration-consent-access",
  marketingGroup: "registration-consent-marketing",
};

/** The read-model item that carries a purpose, across every stated tier. */
function tierItem(
  consents: AuthFlowConsentsConfig,
  purpose: string,
): ConsentItem | undefined {
  for (const tier of consents.tiers ?? []) {
    const found = tier.items.find((item) => item.purpose === purpose);
    if (found) return found;
  }
  return undefined;
}

/**
 * The consent CONTROLS this host renders.
 *
 * A row appears exactly where BOTH halves are true — this host ASKS for the row
 * and its read model carries the item that will be recorded — so a host that
 * shares nothing with partners renders no partner row rather than an empty one,
 * and the Academy, which asks for no rows, renders no control at all while
 * still recording the purposes behind its statement.
 *
 * What each row SAYS is the package's (#2027): the label, the help line and the
 * unmet-condition report come from the copy defaults, so the same declaration
 * cannot read two ways on two storefronts. The tier item's own `statement`
 * stays untouched — that is the RECORDED text, not display copy.
 */
function consentItemsOf(
  config: AuthFlowHostConfig,
  consentCopy: AuthFlowConsentsCopy,
): readonly RegisterCardConsentItem[] {
  const consents = config.consents;
  if (!consents) return [];
  const items: RegisterCardConsentItem[] = [];

  if (consents.medicalWorkerDeclaration) {
    items.push({
      id: MEDWORKER_ID,
      tier: "access",
      label: consentCopy.medicalWorkerDeclaration.label,
      help: consentCopy.medicalWorkerDeclaration.help,
      required: true,
      ...(consentCopy.medicalWorkerDeclaration.unmet
        ? { unmetMessage: consentCopy.medicalWorkerDeclaration.unmet }
        : {}),
      testId: "register-medworker",
      itemTestId: "register-medworker-item",
      helpTestId: "register-medworker-help",
    });
  }

  const partner = tierItem(consents, PARTNER_DATA_SHARING_PURPOSE);
  if (partner && consents.partnerDataItem) {
    items.push({
      id: PARTNER_DATA_SHARING_PURPOSE,
      tier: "access",
      label: consentCopy.partnerDataItem.label,
      help: consentCopy.partnerDataItem.help,
      required: partner.required,
      ...(consentCopy.partnerDataItem.unmet
        ? { unmetMessage: consentCopy.partnerDataItem.unmet }
        : {}),
      testId: "register-partner-data",
      itemTestId: "register-partner-data-item",
      labelTestId: "register-partner-data-statement",
      helpTestId: "register-partner-data-help",
    });
  }

  const marketing = tierItem(consents, MARKETING_COMMUNICATIONS_PURPOSE);
  if (marketing && consents.marketingOptIn) {
    items.push({
      id: MARKETING_COMMUNICATIONS_PURPOSE,
      tier: "marketing",
      label: consentCopy.marketingOptIn.label,
      help: consentCopy.marketingOptIn.help,
      required: marketing.required,
      testId: "register-marketing",
      helpTestId: "register-marketing-help",
    });
  }

  return items;
}

/**
 * What is RECORDED (021 EARS-19): every required item of the read model, plus
 * every optional one the visitor actually ticked, each stamped with the wording
 * version this host's statements were composed at. A required item is recorded
 * whether or not a control was drawn for it — the Academy's sentence is read, not
 * ticked, and the record must still say what was agreed to.
 */
function acceptancesOf(
  config: AuthFlowHostConfig,
  granted: Record<string, boolean>,
): ConsentAcceptance[] {
  const consents = config.consents;
  if (!consents) return [];
  const acceptances: ConsentAcceptance[] = [];
  for (const tier of consents.tiers ?? []) {
    for (const item of tier.items) {
      if (item.required || granted[item.purpose]) {
        acceptances.push({
          purpose: item.purpose,
          version: consents.wordingVersion,
        });
      }
    }
  }
  return acceptances;
}

export function RegisterDoor({
  config,
  landing,
  returnTo = null,
  returnTarget = null,
  carriedTarget = null,
  returnContextPlate,
}: RegisterDoorProps) {
  // #2027 PR 1.6 — `copy.register` is REQUIRED on the config now that both
  // storefronts mount this door, so there is nothing left to assert here.
  const resolvedCopy = resolveAuthFlowCopy(config);
  const copy = resolvedCopy.register;
  const router = useRouter();
  const errors = resolvedCopy.errors;
  const consents = config.consents;
  // One client per host config — the registration ROUTE differs per storefront
  // and is bound once at this boundary, so the call below stays path-free.
  const authClient = useMemo(() => createAuthClient(config.api), [config.api]);

  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);

  const captcha = useBotProtectedAction({
    onVerified: () => setChallengeError(null),
    onChallengeError: (failure) =>
      setChallengeError(
        botProtectionFailureMessage(failure, botProtectionMessages(config)),
      ),
    onActionError: (err) => {
      // 021 EARS-19.4 — a guard that REFUSES the token, or answers that one was
      // required, is a challenge outcome and reads out of the CHALLENGE
      // dictionary beside the widget, never out of `errors.botProtection*`:
      // those two sentences word the surfaces that carry no challenge slot
      // (the sign-in door), and on the doctor host they send the visitor to the
      // other storefront — which from a form that CAN re-run the challenge
      // would be false advice.
      const challenge = botProtectionMessages(config);
      if (isBotProtectionRejected(err)) {
        setChallengeError(challenge.rejected);
        return;
      }
      if (isBotProtectionRequired(err)) {
        setChallengeError(challenge.required);
        return;
      }
      setCommandError(authErrorMessage(err, errors, copy.failed));
    },
  });

  async function finishRegistration(
    values: RegisterCardValues,
    captchaToken?: string,
  ) {
    const email = values.email.trim();
    const body = {
      email,
      password: values.password,
      consent: acceptancesOf(config, values.consents ?? {}),
      // 021 EARS-4 — a DECLARATION, stated by the host and required of the
      // visitor: where the row is drawn at all it is a precondition of the
      // submit, so reaching this line means it was made. A host that states no
      // declaration sends no such key rather than a `false` it never asked about.
      ...(consents?.medicalWorkerDeclaration
        ? { medicalWorkerDeclaration: true }
        : {}),
      // The promo code is render-only (row 9): the command contract carries no
      // such field, so sending one would invent a contract.
    };
    // Row 18: the captcha token travels as the header the client sets.
    await authClient.register(body, captchaToken);
    // 021 EARS-15.4 — hold the typed credential for the step that follows, so
    // the confirmation can sign this visitor in without asking again.
    setPendingRegistration({ identifier: email, password: values.password });

    const verify = config.routes.verify;
    if (verify) {
      // Row 51 — this host confirms the address on a route of its own, and the
      // arrival context rides along so the trip through the mail survives it.
      router.push(
        withReturnTarget(
          `${verify}?email=${encodeURIComponent(email)}`,
          returnTo,
        ),
      );
      return;
    }
    // …and a host that serves no such route confirms here, in place.
    setRegisteredEmail(email);
  }

  function onSubmit(values: RegisterCardValues) {
    setCommandError(null);
    setChallengeError(null);
    // 021 EARS-12 — a precondition the server refuses without which NO rendered
    // row covers (this host words the partner statement, but its read model
    // carries no such item). There is no row to report it on, so it is said
    // ONCE at form level, where every other statement about the command as a
    // whole is said (canvas 56-61), and the command is NOT sent — the refusal is
    // never one the visitor has to infer from a server answer. The submit stays
    // live: nothing here is the visitor's to fix, and a dead button would hide a
    // host MISCONFIGURATION behind what reads as an unfinished form.
    if (missingPrecondition) {
      setCommandError(missingPrecondition);
      return;
    }
    // A hold left by an abandoned attempt must never survive into this one: it
    // would replay a credential this submit is about to replace.
    clearPendingRegistration();
    // 003 EARS-17 — the challenge runs BEFORE the command, the way both
    // storefronts ran it before this door and the way the sign-in door requests
    // a code: `request()` mounts ONE fresh widget and resumes the command with
    // the minted token (tokenless where no site key is configured, which is
    // exactly the guard's no-op when the provider is disabled). Because no
    // tokenless probe is ever sent, a guard that still answers 403
    // `BOT_PROTECTION_REQUIRED` / `BOT_PROTECTION_REJECTED` is a REFUSED
    // CHALLENGE and not a failed command: `onActionError` above states it in
    // the form-level challenge block (021 EARS-19.4), leaves the typed values
    // untouched and releases the submit for another try.
    captcha.request((captchaToken) => finishRegistration(values, captchaToken));
  }

  const consentCopy = resolvedCopy.consents;
  const consentItems = useMemo(
    () => consentItemsOf(config, consentCopy),
    [config, consentCopy],
  );
  // The access frame is drawn wherever an access row stands in it.
  const hasAccessRow = consentItems.some((item) => item.tier === "access");
  const cardCopy: RegisterCardCopy = useMemo(
    () => ({
      title: copy.title,
      description: copy.description,
      emailLabel: copy.emailLabel,
      emailPlaceholder: copy.emailPlaceholder,
      passwordLabel: copy.passwordLabel,
      passwordPlaceholder: copy.passwordPlaceholder,
      // 003 EARS-36 — the length baseline, from the ONE field SSOT. No surface
      // declares a password policy of its own.
      ...(registerFieldHint("password")
        ? { passwordPolicyHint: registerFieldHint("password") as string }
        : {}),
      ...(copy.reveal ? { passwordRevealLabels: copy.reveal } : {}),
      submit: copy.submit,
      ...(hasAccessRow
        ? { accessGroupHeading: consentCopy.accessGroupHeading }
        : {}),
    }),
    [copy, consentCopy, hasAccessRow],
  );

  // The bound field rules of BOTH hosts: the RULE is the package FieldSpec SSOT
  // and the SENTENCE is this host's `copy.fields` string, so no message
  // catalogue is consulted and nothing crosses from an app into the package.
  const fieldRules: RegisterCardProps["fieldRules"] = useMemo(
    () => ({
      email: registerFieldRules(config, "email"),
      password: registerFieldRules(config, "password"),
      // Bound only on a host that renders the box: a rule on an absent field can
      // only ever refuse a submit nobody can fix.
      ...(config.register.promoField
        ? { promoCode: registerFieldRules(config, "promoCode") }
        : {}),
    }),
    [config],
  );

  // The unrenderable precondition itself — see `onSubmit`, which states it at
  // form level the moment the visitor presses. Read here because it is a fact
  // about this host's configuration, not about this attempt.
  const missingPrecondition =
    consents?.partnerDataItem &&
    !tierItem(consents, PARTNER_DATA_SHARING_PURPOSE)
      ? (consentCopy.partnerDataItem.unmet ?? null)
      : null;

  const attribution = config.register.attribution;
  const pointsPromise = config.register.pointsPromise;

  return (
    <RegisterCard
      icon={<RegisterGlyph icon={config.brand.registerIcon ?? "user-plus"} />}
      copy={cardCopy}
      // #2331 — the already-registered visitor's way out, on BOTH doors, with
      // the arrival context carried onward (rule S3).
      footer={
        <DsLink asChild>
          <Link href={withReturnTarget(config.routes.login, returnTo)}>
            {copy.haveAccount}
          </Link>
        </DsLink>
      }
      returnContextSlot={returnContextPlate}
      attributionSlot={
        attribution ? (
          <p className="text-sm text-muted-foreground">{attribution}</p>
        ) : null
      }
      aboveSubmitSlot={
        pointsPromise ? (
          <p
            data-testid="registration-points-promise"
            className="text-sm text-muted-foreground"
          >
            {pointsPromise}
          </p>
        ) : null
      }
      // 003 EARS-20 — the terms sentence, on EVERY storefront and in the
      // position it has stood in since it shipped (canvas 208).
      belowFieldsSlot={
        <p className="text-xs leading-prose text-faint">
          {consentCopy.statement}
        </p>
      }
      captchaSlot={
        <BotProtectionField
          sitekey={botProtectionSiteKey(config)}
          {...captcha.fieldProps}
        />
      }
      confirmation={
        registeredEmail ? (
          // Rows 51 + 76 — a host with no `/verify` route confirms the
          // address HERE. The panel is a module of its own rather than a mode
          // of this one: everything past the accepted code (the login replay,
          // the 005 EARS-2 completion, the EARS-10 landing) is a different
          // rule set with a different transport.
          <RegistrationConfirmation
            config={config}
            email={registeredEmail}
            landing={landing}
            returnTarget={returnTarget}
            carriedTarget={carriedTarget}
            returnContextPlate={returnContextPlate}
          />
        ) : null
      }
      consentItems={consentItems}
      {...(config.register.promoField && copy.promo
        ? {
            promo: {
              label: copy.promo.label,
              placeholder: copy.promo.placeholder,
              testId: "register-promo",
            },
          }
        : {})}
      fieldRules={fieldRules}
      onSubmit={onSubmit}
      errors={{ challenge: challengeError, command: commandError }}
      pending={captcha.pending}
      // The server's landing decision, carried on the element the command
      // belongs to rather than recomputed here (021 LD-3/LD-4).
      formDataAttributes={{ "data-registration-landing": landing }}
      testIds={TEST_IDS}
    />
  );
}
