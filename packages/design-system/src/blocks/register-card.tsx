"use client";

import * as React from "react";
import { useForm, type RegisterOptions, type Resolver } from "react-hook-form";

import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Checkbox } from "../primitives/checkbox";
import { EmailField, PasswordField } from "../primitives/fields";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../primitives/form";
import { Input } from "../primitives/input";
import { AuthCard } from "./auth-card";

/**
 * `<RegisterCard>` (#1934) — the ONE canonical registration composition both
 * storefronts mount (AGENTS.md §6 «Cross-front capability reuse before
 * invention», ADR-0013 A1, the auth family). It joins `<LoginCard>` (#1666
 * slice A), `<PasswordRecoveryCard>` and `<EmailConfirmCard>` (slice B): the
 * Academy `/register` and the doctor storefront `/register` were two
 * hand-assembled forms over the same 003 command, and they are one
 * implementation now.
 *
 * What lives HERE (presentation + form mechanics):
 *   • the `<AuthCard>` frame with the `<h1>` title (the #1033 a11y landmark),
 *   • the email + password fields on the semantic primitives — 003 EARS-37's
 *     one-slot hint-or-error contract is the FIELD's, so this block never
 *     renders a second hint slot beside them,
 *   • the optional promo-code field (021 design §7 — trim on blur, length
 *     bound; no semantic primitive exists because the code vocabulary belongs
 *     to a campaign, not to the form),
 *   • the consent read model rendered as CONTROLS of this form, split by tier:
 *     the access items in a bordered group ABOVE the submit (021 EARS-5,
 *     F-021-1 «вариант Б») and the marketing items separately BELOW it,
 *   • the 021 EARS-12 disabled submit with its reason stated beside it,
 *   • the form-level challenge/command statements (003 EARS-17 / 021 EARS-12)
 *     on the canonical `<FormError>` tone.
 *
 * What stays in the HOST app (the blocks-tier contract — see `./index.ts`):
 * every visible string, i18n, the resolver or field rules (they carry the app's
 * localized messages and the `@ds/schemas` SSOT), BFF transport, the 003
 * EARS-16 outcome mapping, routing, the captcha element (a slot) and the
 * post-submit confirmation step (a slot — see `confirmation`).
 *
 * WHY THE OUTCOME MAPPING IS NOT A BLOCK-LEVEL DISCRIMINANT. 003 EARS-16 makes
 * the BFF answer a brand-new and an already-registered address with the SAME
 * `pending_verification` ack, so an alreadyRegistered branch inside the block
 * would re-introduce on screen the account-existence signal the contract
 * removes. The host awaits its own transport and hands the result back as
 * `errors.command` / `errors.challenge` / `confirmation`, exactly as
 * `<LoginCard>` does with EARS-16.
 *
 * WHY THE CONFIRMATION IS A SLOT AND NOT AN OWNED STAGE. The two hosts confirm
 * in different places: the doctor storefront swaps the door for
 * `<EmailConfirmCard>` in place, while the Academy navigates to its own
 * `/verify` ROUTE (handing the entered credential to that route in memory,
 * #175). A `confirmation` node rendered INSTEAD of the form serves both — the
 * doctor passes the card, the Academy passes nothing and routes.
 */

/** One consent control of the form, as DATA (021 EARS-5 — the host supplies the read model). */
export interface RegisterCardConsentItem {
  /**
   * Stable key — both the RHF field name (`consents.<id>`) and the identity the
   * host reads the granted state back by. ONE path segment, no dots.
   */
  id: string;
  /**
   * Which side of the submit the item stands on, and how it reads: `access` is a
   * PRECONDITION of the command (framed together above the submit), `marketing`
   * is an optional opt-in standing below it in the quieter tone. The two tiers
   * are told apart by their RENDERING and not by wording alone — the whole point
   * of F-021-1 «вариант Б».
   */
  tier: "access" | "marketing";
  /** The statement the visitor reads. Data, never a copy blob baked into the package. */
  label: React.ReactNode;
  /** The secondary line under the statement (the legal reason, the optionality note). */
  help?: React.ReactNode;
  /** Defaults to true for an access item and false for a marketing one. */
  required?: boolean;
  /** 021 EARS-12 — what the disabled submit says while THIS item is unticked. */
  unmetMessage?: string;
  /** The «необязательно» marker rendered inline after the statement. */
  optionalTag?: React.ReactNode;
  /** `data-testid` on that marker. */
  optionalTagTestId?: string;
  /** `data-testid` on the checkbox itself. */
  testId?: string;
  /** `data-testid` on the row (`FormItem`). */
  itemTestId?: string;
  /** `data-testid` on the statement span. */
  labelTestId?: string;
  /** `data-testid` on the help line. */
  helpTestId?: string;
}

/** The optional promo-code field (021 design §7). Absent → the field is not rendered at all. */
export interface RegisterCardPromoProps {
  label: React.ReactNode;
  placeholder?: string;
  testId?: string;
  /** Length bound and its message; omitted → no bound is asserted. */
  maxLength?: number;
  maxLengthMessage?: string;
}

/** The form values. `consents` is keyed by `RegisterCardConsentItem.id`. */
export interface RegisterCardValues {
  email: string;
  password: string;
  promoCode: string;
  consents: Record<string, boolean>;
}

/** Every visible string the block renders. No copy lives in the package (the #235 i18n contract). */
export interface RegisterCardCopy {
  title: React.ReactNode;
  description?: React.ReactNode;
  emailLabel: string;
  emailPlaceholder?: string;
  passwordLabel: string;
  /** The length baseline ONLY — 003 EARS-36 forbids a surface declaring a second password policy. */
  passwordPolicyHint?: string;
  submit: React.ReactNode;
  /** Accessible name of the access consent group, and its visible heading bar. */
  accessGroupHeading?: React.ReactNode;
}

/** `data-testid`s the hosts' shipped e2e query. Every one is optional — omitted means no attribute. */
export interface RegisterCardTestIds {
  root?: string;
  card?: string;
  /** Wrapper of the 021 EARS-2 gate-context plate. */
  returnContext?: string;
  /** Wrapper of the 021 EARS-8 representative/organisation line. */
  attribution?: string;
  form?: string;
  email?: string;
  password?: string;
  promo?: string;
  submit?: string;
  submitReason?: string;
  challengeError?: string;
  commandError?: string;
  accessGroup?: string;
  marketingGroup?: string;
  note?: string;
}

export interface RegisterCardProps {
  copy: RegisterCardCopy;
  /** Card glyph (app-supplied — the package carries no icon set). */
  icon?: React.ReactNode;
  /** `<AuthCard>` footer — secondary links (the Academy «уже есть аккаунт»). */
  footer?: React.ReactNode;
  /** 021 EARS-2 — the gate context plate above the card. Absent → NOTHING renders (EARS-3 honest-empty rule). */
  returnContextSlot?: React.ReactNode;
  /** 021 EARS-8 — the representative/organisation line, same honest-empty rule. */
  attributionSlot?: React.ReactNode;
  /** 021 EARS-9 — the points promise, inside the form, above the submit group. */
  aboveSubmitSlot?: React.ReactNode;
  /** The host bot-protection element (003 EARS-17), rendered inside the submit group. */
  captchaSlot?: React.ReactNode;
  /**
   * The post-submit state. Non-null replaces the WHOLE form, and the form
   * surroundings deliberately do NOT travel with it: they are pre-submission
   * framing of a decision the visitor has now made.
   */
  confirmation?: React.ReactNode;
  /** The consent read model, in rendered order within each tier. */
  consentItems?: readonly RegisterCardConsentItem[];
  /** 021 EARS-7 — the withdrawal statement below the form. Absent → not rendered. */
  consentNote?: React.ReactNode;
  promo?: RegisterCardPromoProps;
  /** App-owned RHF resolver (localized messages + the `@ds/schemas` SSOT). */
  resolver?: Resolver<RegisterCardValues>;
  /**
   * Per-field RHF rules, for a host that validates without a resolver. Mutually
   * exclusive with `resolver` in practice — RHF ignores field rules once a
   * resolver is set.
   */
  fieldRules?: {
    email?: RegisterOptions<RegisterCardValues, "email">;
    password?: RegisterOptions<RegisterCardValues, "password">;
    /**
     * The promo field's rules, for a host that derives them from its own
     * FieldSpec SSOT rather than restating a bound here. Supplied → it wins
     * over `promo.maxLength`, which stays for hosts that only have a number.
     */
    promoCode?: RegisterOptions<RegisterCardValues, "promoCode">;
  };
  /** Awaited by RHF, so it drives `isSubmitting`. Transport + EARS-16 mapping are the host's. */
  onSubmit: (values: RegisterCardValues) => Promise<void> | void;
  /** Client validation refused the submit — the host may surface its own statement. */
  onInvalid?: () => void;
  /**
   * Already-localized FORM-level statements, held apart on purpose: a fresh
   * challenge clears `challenge` without erasing a `command` failure the visitor
   * still has to read. Neither belongs on a field — no field is wrong.
   */
  errors?: { challenge?: React.ReactNode; command?: React.ReactNode };
  /** Host-side pending signal (e.g. an in-flight captcha challenge). */
  pending?: boolean;
  /**
   * How the pending state reads on the submit. `spinner` is the #337 loading
   * affordance; `inert` keeps the button plainly disabled — the doctor door
   * shipped render, where the button is already the EARS-12 disabled control and
   * a spinner would add a second, competing busy signal.
   */
  pendingAffordance?: "spinner" | "inert";
  /**
   * The submit group composition, and the ONLY structural fork between the two
   * hosts' shipped renders:
   *   • `error-first` — captcha, then the statements, then the button, flowing in
   *     the form own spacing (the Academy `/register`);
   *   • `submit-first` — the button and its EARS-12 reason first, then the
   *     statements, then the captcha, inside their own tight group (the doctor
   *     door, where the reason must sit immediately under the control it explains).
   * Neither order may change without a Stage-B re-confirmation, so the fork is an
   * explicit prop rather than a silent pick by the block.
   */
  submitBlock?: "error-first" | "submit-first";
  /**
   * Vertical rhythm between the form rows. Exists for the same reason as
   * `submitBlock`: the two shipped surfaces stand at different steps of the
   * spacing scale and neither may be nudged without a Stage-B re-confirmation.
   */
  spacing?: "sm" | "md";
  /**
   * 021 EARS-12 — an unmet precondition NO rendered item covers (e.g. the
   * partner-data consent missing from the read model entirely, which the server
   * still refuses without). Stated once every rendered item is granted.
   */
  unmetPrecondition?: string | null;
  /**
   * Extra `data-*` attributes published on the `<form>` element — the doctor
   * door 021 EARS-3 landing decision (`data-registration-landing`), resolved on
   * the server and carried as a fact rather than a hidden input.
   */
  formDataAttributes?: Record<string, string>;
  testIds?: RegisterCardTestIds;
}

const SPACING_CLASS: Record<"sm" | "md", string> = {
  sm: "space-y-4",
  md: "flex flex-col gap-4.5",
};

/** Stable empty read model — a fresh literal each render would churn the filters for nothing. */
const EMPTY_ITEMS: readonly RegisterCardConsentItem[] = [];

/** Optional `data-testid` — omitted entirely rather than rendered empty. */
function testIdProps(id: string | undefined) {
  return id ? { "data-testid": id } : {};
}

/** Same idea for the primitives that take a `testId` prop rather than the attribute. */
function testIdProps2(id: string | undefined) {
  return id ? { testId: id } : {};
}

export function RegisterCard({
  copy,
  icon,
  footer,
  returnContextSlot,
  attributionSlot,
  aboveSubmitSlot,
  captchaSlot,
  confirmation,
  consentItems,
  consentNote,
  promo,
  resolver,
  fieldRules,
  onSubmit,
  onInvalid,
  errors,
  pending = false,
  pendingAffordance = "spinner",
  submitBlock = "error-first",
  spacing = "sm",
  unmetPrecondition = null,
  formDataAttributes,
  testIds,
}: RegisterCardProps) {
  const items = consentItems ?? EMPTY_ITEMS;
  const accessItems = items.filter((item) => item.tier === "access");
  const marketingItems = items.filter((item) => item.tier === "marketing");

  // Never pre-ticked: a pre-ticked consent is the platform consenting on the
  // visitor behalf, which is the one thing a consent cannot be. Built once —
  // RHF reads `defaultValues` on mount only.
  const defaultConsents = React.useRef(
    Object.fromEntries(items.map((item) => [item.id, false])),
  ).current;

  const form = useForm<RegisterCardValues>({
    // `onTouched` (#200): surface a malformed value on blur rather than holding
    // it back until a submit. Applied consistently across every auth form.
    mode: "onTouched",
    ...(resolver ? { resolver } : {}),
    defaultValues: {
      email: "",
      password: "",
      promoCode: "",
      consents: defaultConsents,
    },
  });

  const idPrefix = React.useId();
  const reasonId = idPrefix + "-register-submit-reason";
  const accessHeadingId = idPrefix + "-register-access-heading";

  // 021 EARS-12 — the reason beside the disabled submit names the SPECIFIC unmet
  // condition, in the order the conditions are read on screen; once every
  // rendered one is granted the host own precondition (if any) is stated, and
  // `null` is the enabled state — the paragraph is then ABSENT rather than empty
  // (EARS-3 honest-empty rule, same as every other slot).
  const grantedConsents = form.watch("consents");
  const firstUnmet = accessItems.find(
    (item) => (item.required ?? true) && !grantedConsents?.[item.id],
  );
  const submitReason = firstUnmet
    ? (firstUnmet.unmetMessage ?? null)
    : unmetPrecondition;

  const busy = form.formState.isSubmitting || pending;

  const root = (children: React.ReactNode) => (
    <div
      {...testIdProps(testIds?.root)}
      className="flex w-full flex-col gap-4.5"
    >
      {children}
    </div>
  );

  // A command that succeeded never shows nothing: the door becomes the host
  // confirmation state, and the form surroundings do not travel with it.
  if (confirmation) return root(confirmation);

  const errorStatements = (
    <>
      <FormError {...testIdProps(testIds?.challengeError)}>
        {errors?.challenge}
      </FormError>
      <FormError {...testIdProps(testIds?.commandError)}>
        {errors?.command}
      </FormError>
    </>
  );

  const submitControl = (
    <>
      <Button
        type="submit"
        className="w-full"
        // Disabled ONLY while a stated condition is unmet — a silently dead
        // button exists in no state (021 EARS-12).
        disabled={
          submitReason !== null || (pendingAffordance === "inert" && busy)
        }
        loading={pendingAffordance === "spinner" && busy}
        {...(submitReason === null ? {} : { "aria-describedby": reasonId })}
        {...testIdProps(testIds?.submit)}
      >
        {copy.submit}
      </Button>
      {submitReason ? (
        <p
          id={reasonId}
          {...testIdProps(testIds?.submitReason)}
          className="text-sm font-medium text-muted-foreground"
        >
          {submitReason}
        </p>
      ) : null}
    </>
  );

  return root(
    <>
      {/* Supplied or absent, never an empty frame (021 EARS-2 / EARS-3). */}
      {returnContextSlot ? (
        <div {...testIdProps(testIds?.returnContext)}>{returnContextSlot}</div>
      ) : null}
      {attributionSlot ? (
        <div {...testIdProps(testIds?.attribution)}>{attributionSlot}</div>
      ) : null}

      <AuthCard
        {...testIdProps(testIds?.card)}
        icon={icon}
        // #1033: the page title is the document single h1 (a11y landmark).
        // Bare h1 — Tailwind preflight makes it inherit the CardTitle styling.
        title={<h1>{copy.title}</h1>}
        description={copy.description}
        footer={footer}
      >
        <Form {...form}>
          <form
            {...testIdProps(testIds?.form)}
            {...formDataAttributes}
            className={SPACING_CLASS[spacing]}
            noValidate
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
          >
            <FormField
              control={form.control}
              name="email"
              {...(fieldRules?.email ? { rules: fieldRules.email } : {})}
              render={({ field }) => (
                <EmailField
                  field={field}
                  label={copy.emailLabel}
                  {...(copy.emailPlaceholder === undefined ? {} : { placeholder: copy.emailPlaceholder })}
                  {...testIdProps2(testIds?.email)}
                />
              )}
            />

            <FormField
              control={form.control}
              name="password"
              {...(fieldRules?.password ? { rules: fieldRules.password } : {})}
              render={({ field }) => (
                <PasswordField
                  field={field}
                  purpose="new"
                  label={copy.passwordLabel}
                  {...(copy.passwordPolicyHint === undefined ? {} : { policyHint: copy.passwordPolicyHint })}
                  {...testIdProps2(testIds?.password)}
                />
              )}
            />

            {promo ? (
              <FormField
                control={form.control}
                name="promoCode"
                {...(fieldRules?.promoCode
                  ? { rules: fieldRules.promoCode }
                  : promo.maxLength === undefined
                    ? {}
                    : {
                        rules: {
                          maxLength: {
                            value: promo.maxLength,
                            message: promo.maxLengthMessage ?? "",
                          },
                        },
                      })}
                render={({ field }) => (
                  // No semantic primitive exists for a promo code, and one would
                  // be wrong: the code vocabulary belongs to a campaign, not to
                  // the form (021 design §7). Composed from the sanctioned
                  // `FormItem`/`Input` primitives, never hand-rolled.
                  <FormItem>
                    <FormLabel>{promo.label}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder={promo.placeholder}
                        {...testIdProps(promo.testId)}
                        {...field}
                        value={field.value ?? ""}
                        // Trim on BLUR, never per keystroke: stripping on every
                        // change makes an interior space untypable, silently
                        // rewriting what was typed. Blur covers the paste case
                        // design §7 asks for.
                        onBlur={(event) => {
                          field.onChange(event.target.value.trim());
                          field.onBlur();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/*
              021 EARS-5 — TIER 1, the access conditions, framed TOGETHER above
              the submit (F-021-1 «вариант Б», the owner pick). The frame is the
              whole point of the variant: the tiers are told apart by their
              RENDERING, so tier 1 is a bordered group under its own heading and
              tier 2 stands outside it, below the submit.
            */}
            {accessItems.length ? (
              <div
                {...testIdProps(testIds?.accessGroup)}
                className="border-2 border-border"
                role="group"
                aria-labelledby={
                  copy.accessGroupHeading ? accessHeadingId : undefined
                }
              >
                {copy.accessGroupHeading ? (
                  <p
                    id={accessHeadingId}
                    className="border-b-2 border-border bg-muted px-3.5 py-2.5 text-xs font-extrabold uppercase tracking-widest"
                  >
                    {copy.accessGroupHeading}
                  </p>
                ) : null}
                <div className="flex flex-col gap-3.5 px-3.5 py-4">
                  {accessItems.map((item) => (
                    <ConsentControl
                      key={item.id}
                      item={item}
                      control={form.control}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* 021 EARS-9 — the promise, read from configuration by the host. */}
            {aboveSubmitSlot ? <div>{aboveSubmitSlot}</div> : null}

            {submitBlock === "submit-first" ? (
              <div className="flex flex-col gap-2.5">
                {submitControl}
                {errorStatements}
                {captchaSlot}
              </div>
            ) : (
              <>
                {captchaSlot}
                {errorStatements}
                {submitControl}
              </>
            )}

            {/*
              021 EARS-5 — TIER 2, the optional opt-in, standing SEPARATELY below
              the submit and outside tier 1 frame. Its optionality is stated on
              the control and carried by its rendering: it is not in the group the
              submit depends on.
            */}
            {marketingItems.length ? (
              <div {...testIdProps(testIds?.marketingGroup)}>
                {marketingItems.map((item) => (
                  <ConsentControl
                    key={item.id}
                    item={item}
                    control={form.control}
                  />
                ))}
              </div>
            ) : null}

            {/*
              021 EARS-7 — the withdrawal statement that belongs to the block, and
              the only thing this surface says about changing a consent. No toggle
              beside it: a change is a request handled by a platform manager, and a
              control here would promise a mechanism this surface does not have.
            */}
            {consentNote ? (
              <p
                {...testIdProps(testIds?.note)}
                className="text-xs text-muted-foreground"
              >
                {consentNote}
              </p>
            ) : null}
          </form>
        </Form>
      </AuthCard>
    </>,
  );
}

/**
 * One consent line. Built from the design system checkbox primitive, never a
 * hand-assembled input: the box, its checked/focus/disabled states and the label
 * association are the primitive.
 *
 * A marketing statement reads in the quieter muted tone — the optionality is
 * carried by the rendering, not by wording alone — and carries no `FormMessage`,
 * because an optional control has no unmet state to report.
 */
function ConsentControl({
  item,
  control,
}: {
  item: RegisterCardConsentItem;
  control: ReturnType<typeof useForm<RegisterCardValues>>["control"];
}) {
  const required = item.required ?? item.tier === "access";

  return (
    <FormField
      control={control}
      name={`consents.${item.id}`}
      {...(required ? { rules: { required: item.unmetMessage ?? true } } : {})}
      render={({ field }) => (
        <FormItem {...testIdProps(item.itemTestId)}>
          <FormControl>
            <Checkbox
              className="items-start"
              {...testIdProps(item.testId)}
              name={field.name}
              ref={field.ref}
              checked={Boolean(field.value)}
              onBlur={field.onBlur}
              onChange={(event) => field.onChange(event.target.checked)}
            >
              <span className="flex flex-col gap-1">
                <span
                  {...testIdProps(item.labelTestId)}
                  className={
                    item.tier === "marketing"
                      ? "text-muted-foreground"
                      : undefined
                  }
                >
                  {item.label}
                  {item.optionalTag ? (
                    <Badge
                      variant="label"
                      className="ml-1.5 align-middle"
                      {...testIdProps(item.optionalTagTestId)}
                    >
                      {item.optionalTag}
                    </Badge>
                  ) : null}
                </span>
                {item.help ? (
                  <span
                    {...testIdProps(item.helpTestId)}
                    className="text-sm text-muted-foreground"
                  >
                    {item.help}
                  </span>
                ) : null}
              </span>
            </Checkbox>
          </FormControl>
          {/* 021 EARS-12 — actionable, in the field where it occurred. */}
          {required ? <FormMessage /> : null}
        </FormItem>
      )}
    />
  );
}
