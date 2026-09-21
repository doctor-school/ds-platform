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

import { botProtectionMessages, botProtectionSiteKey } from "../bot-protection";
import { createAuthClient } from "../client/auth-client";
import { authErrorMessage } from "../errors";
import { registerFieldHint, registerFieldRules } from "../fields";
import type {
  AuthFlowConsentsConfig,
  AuthFlowHostConfig,
  AuthFlowRegisterCopy,
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
 * groups, the submit group and the EARS-12 blocked-submit reason are the
 * design-system `<RegisterCard>` block (ADR-0013 A1); what the door adds is the
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
};

/**
 * This host's registration sentences, or a loud failure.
 *
 * `copy.register` is optional on the config because not every auth host has to
 * carry a registration door; a host that mounts THIS component without stating
 * the words is a wiring mistake, and it must read as one at the boundary rather
 * than as a card full of blanks. Returning the non-optional type also keeps the
 * narrowing through the door's own nested handlers.
 */
function registerCopyOf(config: AuthFlowHostConfig): AuthFlowRegisterCopy {
  const copy = config.copy.register;
  if (!copy) {
    throw new Error("auth-flow: this host states no registration copy");
  }
  return copy;
}

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
  submitReason: "register-submit-reason",
  challengeError: "register-captcha-error",
  commandError: "register-command-error",
  accessGroup: "registration-consent-access",
  marketingGroup: "registration-consent-marketing",
  note: "registration-consent-manager-note",
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
 * A row appears exactly where BOTH halves are stated — the read-model item that
 * will be recorded AND the copy of the row drawn around it — so a host that
 * shares nothing with partners renders no partner row rather than an empty one,
 * and the Academy, which states one read-only sentence and no row copy, renders
 * no control at all while still recording the purpose behind that sentence.
 */
function consentItemsOf(
  config: AuthFlowHostConfig,
): readonly RegisterCardConsentItem[] {
  const consents = config.consents;
  if (!consents) return [];
  const items: RegisterCardConsentItem[] = [];

  const declaration = consents.medicalWorkerDeclaration;
  if (declaration) {
    items.push({
      id: MEDWORKER_ID,
      tier: "access",
      label: declaration.label,
      help: declaration.help,
      required: true,
      unmetMessage: declaration.unmet,
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
      label: partner.statement,
      help: consents.partnerDataItem.help,
      required: partner.required,
      unmetMessage: consents.partnerDataItem.unmet,
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
      label: marketing.statement,
      help: consents.marketingOptIn.help,
      required: marketing.required,
      optionalTag: consents.marketingOptIn.optionalTag,
      optionalTagTestId: "register-marketing-optional-tag",
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
  const copy = registerCopyOf(config);
  const router = useRouter();
  const errors = config.copy.errors;
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
      if (isBotProtectionRejected(err)) {
        setChallengeError(errors.botProtectionRejected);
        return;
      }
      if (isBotProtectionRequired(err)) {
        setChallengeError(errors.botProtectionRequired);
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

  async function onSubmit(values: RegisterCardValues) {
    setCommandError(null);
    setChallengeError(null);
    // A hold left by an abandoned attempt must never survive into this one: it
    // would replay a credential this submit is about to replace.
    clearPendingRegistration();
    try {
      await finishRegistration(values);
    } catch (err) {
      if (isBotProtectionRequired(err)) {
        // Retry ONCE with the ORIGINAL values: the challenge resumes the command
        // the visitor already submitted, never a re-read of a mutated form.
        captcha.request((captchaToken) =>
          finishRegistration(values, captchaToken),
        );
        return;
      }
      // EARS-16: the registration OUTCOME stays the host's generic sentence, so
      // the surface never tells a stranger whether an address is registered
      // here; only the non-oracle statuses get a specific one.
      setCommandError(authErrorMessage(err, errors, copy.failed));
    }
  }

  const consentItems = useMemo(() => consentItemsOf(config), [config]);
  const cardCopy: RegisterCardCopy = useMemo(
    () => ({
      title: copy.title,
      description: copy.description,
      emailLabel: copy.emailLabel,
      emailPlaceholder: copy.emailPlaceholder,
      passwordLabel: copy.passwordLabel,
      // 003 EARS-36 — the length baseline, from the ONE field SSOT. No surface
      // declares a password policy of its own.
      ...(registerFieldHint("password")
        ? { passwordPolicyHint: registerFieldHint("password") as string }
        : {}),
      ...(copy.reveal ? { passwordRevealLabels: copy.reveal } : {}),
      submit: copy.submit,
      ...(consents?.accessGroupHeading
        ? { accessGroupHeading: consents.accessGroupHeading }
        : {}),
    }),
    [copy, consents],
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

  // 021 EARS-12 — a precondition the server still refuses without and NO
  // rendered row covers: the host words the row but its read model carries no
  // such statement, so the submit stays shut with the reason stated.
  const unmetPrecondition =
    consents?.partnerDataItem &&
    !tierItem(consents, PARTNER_DATA_SHARING_PURPOSE)
      ? consents.partnerDataItem.unmet
      : null;

  const form = config.register.form;
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
      // 003 EARS-20 — the read-only consent sentence a host shows INSTEAD of
      // controls, in the position it has stood in since it shipped.
      belowFieldsSlot={
        consents?.statement ? (
          <p className="text-xs text-muted-foreground">{consents.statement}</p>
        ) : null
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
          />
        ) : null
      }
      consentItems={consentItems}
      // 021 EARS-7 — stated where this host has consent rows at all.
      consentNote={
        consents?.tiers?.length ? (consents.managerNote ?? null) : null
      }
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
      // Absent = the block's own defaults, which ARE the Academy's shipped
      // render; the doctor host states its Stage-B-evidenced values.
      {...(form
        ? {
            submitBlock: form.submitBlock,
            spacing: form.spacing,
            pendingAffordance: form.pendingAffordance,
          }
        : {})}
      unmetPrecondition={unmetPrecondition}
      // The server's landing decision, carried on the element the command
      // belongs to rather than recomputed here (021 LD-3/LD-4).
      formDataAttributes={{ "data-registration-landing": landing }}
      testIds={TEST_IDS}
    />
  );
}
