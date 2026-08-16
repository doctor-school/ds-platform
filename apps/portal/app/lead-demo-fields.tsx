"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

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

type SubmitAction = (
  input: AcademyPartnershipSubmission,
) => Promise<AcademyPartnershipActionResult>;

export interface LeadDemoFieldsProps {
  submitAction: SubmitAction;
}

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

export function LeadDemoFields({ submitAction }: LeadDemoFieldsProps) {
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [summaryFocusRequest, setSummaryFocusRequest] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const lastSummaryFocusRequestRef = useRef(0);
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

  async function onSubmit(values: AcademyPartnershipSubmission) {
    setSubmitError(null);
    try {
      const result = await submitAction(values);
      if (result.status === "success") {
        setSaved(true);
        return;
      }
      if (result.status === "invalid") {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          if (field === "idempotencyKey" || !message) continue;
          form.setError(
            field as Exclude<keyof AcademyPartnershipSubmissionInput, "idempotencyKey">,
            { type: "server", message },
          );
        }
        setSummaryFocusRequest((request) => request + 1);
        return;
      }
      setSubmitError(result.message);
    } catch {
      setSubmitError(ACADEMY_PARTNERSHIP_WRITE_ERROR);
    }
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
                <Input {...field} placeholder="Как к вам обращаться" />
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
                <Input {...field} placeholder="name@company.ru или @username" />
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
                <NativeSelect {...field} value={field.value ?? ""}>
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
                aria-invalid={fieldState.invalid}
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
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />

        <FormError tone="on-primary">{submitError}</FormError>
        <Button
          type="submit"
          variant="on-primary"
          size="lg"
          loading={form.formState.isSubmitting}
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
      </form>
    </Form>
  );
}
