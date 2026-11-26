"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BotProtectionDisclosure,
  botProtectionMessages,
} from "@ds/auth-flow/bot-protection";
import { ACADEMY_AUTH_FLOW } from "@ds/auth-flow/hosts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import {
  BotProtectionField,
  botProtectionFailureMessage,
  isBotProtectionRejected,
  isBotProtectionRequired,
  useBotProtectedAction,
} from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import { Checkbox } from "@ds/design-system/checkbox";
import {
  Form,
  FormControl,
  FormError,
  FormErrorSummary,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  type FormErrorSummaryItem,
} from "@ds/design-system/form";
import { Input } from "@ds/design-system/input";
import { Link } from "@ds/design-system/link";
import { NativeSelect } from "@ds/design-system/native-select";

import {
  ACADEMY_PARTNERSHIP_ROLES,
  ACADEMY_PARTNERSHIP_WRITE_ERROR,
  ACADEMY_CONSENT_TEXT,
  ACADEMY_PRIVACY_POLICY_URL,
  AcademyPartnershipSubmissionSchema,
  type AcademyPartnershipActionResult,
  type AcademyPartnershipSubmission,
  type AcademyPartnershipSubmissionInput,
} from "@/lib/academy-partnership-schema";
import { postAcademyPartnership } from "@/lib/academy-partnership-client";

type SubmitAction = (
  input: AcademyPartnershipSubmission,
  captchaToken?: string,
) => Promise<AcademyPartnershipActionResult>;

export interface LeadDemoFieldsProps {
  /** 033 EARS-18 — one attempt against the queue intake; injectable for tests. */
  submitAction?: SubmitAction;
  /**
   * The public SmartCaptcha site key the server page read from its runtime env
   * (#2981). Absent — the dev-stand default — the attempt goes tokenless,
   * matching the api guard's no-op without a provider.
   */
  botProtectionSiteKey?: string | undefined;
}

// The Academy host's challenge copy (003 EARS-17): the same sentences its auth
// doors show, read from the shared auth-flow catalog.
const CHALLENGE_MESSAGES = botProtectionMessages(ACADEMY_AUTH_FLOW);

const SUMMARY_FIELDS: ReadonlyArray<{
  name: Exclude<keyof AcademyPartnershipSubmissionInput, "idempotencyKey">;
  fieldId: string;
}> = [
  { name: "name", fieldId: "academy-partner-name-field" },
  { name: "companyOrClinic", fieldId: "academy-partner-company-field" },
  { name: "contact", fieldId: "academy-partner-contact-field" },
  { name: "role", fieldId: "academy-partner-role-field" },
  { name: "consent", fieldId: "academy-partner-consent-field" },
];
const BLUR_ERROR_DELAY_MS = 100;
const CONSENT_MESSAGE_ID = "academy-partner-consent-message";

function submissionFingerprint(values: AcademyPartnershipSubmission): string {
  return JSON.stringify({
    name: values.name,
    companyOrClinic: values.companyOrClinic,
    contact: values.contact,
    role: values.role,
    consent: values.consent,
  });
}

export function LeadDemoFields({
  submitAction = postAcademyPartnership,
  botProtectionSiteKey,
}: LeadDemoFieldsProps) {
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [summaryFocusRequest, setSummaryFocusRequest] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const lastSummaryFocusRequestRef = useRef(0);
  const lastAttemptRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const form = useForm<
    AcademyPartnershipSubmissionInput,
    unknown,
    AcademyPartnershipSubmission
  >({
    mode: "onTouched",
    // Keep the DS on-blur contract while letting a pointer click finish before
    // a newly wrapped inline error can move the submit button under the cursor.
    delayError: BLUR_ERROR_DELAY_MS,
    shouldFocusError: false,
    resolver: zodResolver(AcademyPartnershipSubmissionSchema),
    defaultValues: {
      idempotencyKey: crypto.randomUUID(),
      name: "",
      companyOrClinic: "",
      contact: "",
      role: undefined,
      consent: false,
    },
  });

  const captcha = useBotProtectedAction({
    onVerified: () => setSubmitError(null),
    onChallengeError: (failure) =>
      setSubmitError(botProtectionFailureMessage(failure, CHALLENGE_MESSAGES)),
    onActionError: (error) => {
      if (isBotProtectionRejected(error)) {
        setSubmitError(CHALLENGE_MESSAGES.rejected);
      } else if (isBotProtectionRequired(error)) {
        setSubmitError(CHALLENGE_MESSAGES.required);
      } else {
        setSubmitError(ACADEMY_PARTNERSHIP_WRITE_ERROR);
      }
    },
  });

  const summaryErrors = useMemo<readonly FormErrorSummaryItem[]>(
    () =>
      SUMMARY_FIELDS.flatMap(({ name, fieldId }) => {
        const message = form.formState.errors[name]?.message;
        return typeof message === "string" ? [{ fieldId, message }] : [];
      }),
    [form.formState.errors],
  );

  useEffect(() => {
    if (
      summaryFocusRequest > lastSummaryFocusRequestRef.current &&
      summaryErrors.length > 0
    ) {
      lastSummaryFocusRequestRef.current = summaryFocusRequest;
      summaryRef.current?.focus();
    }
  }, [summaryErrors, summaryFocusRequest]);

  function onSubmit(values: AcademyPartnershipSubmission) {
    setSubmitError(null);
    const fingerprint = submissionFingerprint(values);
    const previousAttempt = lastAttemptRef.current;
    const idempotencyKey =
      previousAttempt && previousAttempt.fingerprint !== fingerprint
        ? crypto.randomUUID()
        : (previousAttempt?.idempotencyKey ?? values.idempotencyKey);
    const submission = { ...values, idempotencyKey };
    if (idempotencyKey !== values.idempotencyKey) {
      form.setValue("idempotencyKey", idempotencyKey);
    }
    lastAttemptRef.current = { fingerprint, idempotencyKey };
    // 033 EARS-18: each attempt mints one fresh proof; a retry of the same
    // values reuses the idempotency key, so the queue keeps one row.
    captcha.request(async (captchaToken) => {
      const result = await submitAction(submission, captchaToken);
      if (result.status === "success") {
        setSaved(true);
        return;
      }
      if (result.status === "invalid") {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          if (field === "idempotencyKey" || !message) continue;
          form.setError(
            field as Exclude<
              keyof AcademyPartnershipSubmissionInput,
              "idempotencyKey"
            >,
            { type: "server", message },
          );
        }
        setSummaryFocusRequest((request) => request + 1);
        return;
      }
      setSubmitError(result.message);
    });
  }

  function onInvalid() {
    setSubmitError(null);
    setSummaryFocusRequest((request) => request + 1);
  }

  if (saved) {
    return (
      <p role="status" className="text-xl font-extrabold">
        Спасибо! Заявка сохранена.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form
        aria-label="Форма партнёрства"
        noValidate
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="space-y-4.5 text-primary-surface-foreground"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="academy-partner-name-field" required>
                Имя
              </FormLabel>
              <FormControl id="academy-partner-name-field">
                <Input {...field} required placeholder="Как к вам обращаться" />
              </FormControl>
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="companyOrClinic"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="academy-partner-company-field">
                Компания или клиника
              </FormLabel>
              <FormControl id="academy-partner-company-field">
                <Input {...field} placeholder="Название организации" />
              </FormControl>
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="contact"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="academy-partner-contact-field" required>
                Email или Telegram
              </FormLabel>
              <FormControl id="academy-partner-contact-field">
                <Input
                  {...field}
                  required
                  placeholder="name@company.ru или @username"
                />
              </FormControl>
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="academy-partner-role-field" required>
                Роль
              </FormLabel>
              <FormControl id="academy-partner-role-field">
                <NativeSelect {...field} required value={field.value ?? ""}>
                  <option value="" disabled>
                    Выберите роль
                  </option>
                  {ACADEMY_PARTNERSHIP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="consent"
          render={({ field, fieldState }) => (
            <FormItem>
              <Checkbox
                id="academy-partner-consent-field"
                ref={field.ref}
                name={field.name}
                checked={field.value}
                onBlur={field.onBlur}
                onChange={(event) => field.onChange(event.target.checked)}
                required
                aria-required="true"
                aria-invalid={fieldState.invalid}
                aria-describedby={
                  fieldState.invalid ? CONSENT_MESSAGE_ID : undefined
                }
                tone="on-primary"
              >
                {ACADEMY_CONSENT_TEXT}
              </Checkbox>
              <span className="text-caption">
                <Link
                  href={ACADEMY_PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="inline"
                  tone="on-primary"
                >
                  Политика конфиденциальности
                </Link>
              </span>
              <FormMessage id={CONSENT_MESSAGE_ID} tone="on-primary" />
            </FormItem>
          )}
        />

        <FormError tone="on-primary">{submitError}</FormError>
        <Button
          type="submit"
          variant="on-primary"
          size="lg"
          loading={form.formState.isSubmitting || captcha.pending}
          className="w-full"
        >
          Обсудить партнёрство
        </Button>
        <FormErrorSummary
          ref={summaryRef}
          title="Исправьте ошибки в форме"
          errors={summaryErrors}
          data-testid="academy-form-error-summary"
        />
        <BotProtectionField
          sitekey={botProtectionSiteKey}
          {...captcha.fieldProps}
        />
        {/* Yandex SmartCaptcha's notice: the widget runs with its shield
            hidden, so the form states the protection itself (003 EARS-17). */}
        <BotProtectionDisclosure
          config={{
            ...ACADEMY_AUTH_FLOW,
            botProtection: { siteKey: botProtectionSiteKey },
          }}
          tone="on-primary"
        />
      </form>
    </Form>
  );
}
