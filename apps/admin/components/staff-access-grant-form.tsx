"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button, Input, Label, NativeSelect } from "@ds/design-system";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@ds/design-system/sheet";
import { Combobox, type ComboboxOption } from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import type { StaffAccessRow } from "@ds/schemas";
import {
  fetchStaffAccessEventPage,
  GRANT_FORM_EMPTY,
  grantFormIssues,
  grantOutcome,
  grantRefusal,
  grantRequestOf,
  STAFF_ACCESS_GRANT_ENDPOINT,
  STAFF_ACCESS_GRANTS_PATH,
  STAFF_ACCESS_ROLES,
  STAFF_ACCESS_ROUTE,
  staffAccessRoleLabelKey,
  staffAccessRoleTakesEvent,
  type GrantFormFields,
  type GrantOutcome,
  type GrantRefusal,
} from "@/lib/staff-access";
import {
  browserStepUpStorage,
  saveStepUpRequest,
  stepUpChallengeHref,
} from "@/lib/step-up";
import { useServerCombobox } from "@/lib/use-server-combobox";
import type { SlotProps } from "@/components/combobox-slot-props";

/** The form lives in the panel body, its actions in the footer: one id joins them. */
const FORM_ID = "staff-access-grant-form";

/** A grant the step-up interrupted, restored on the way back from the code screen. */
export interface StaffAccessGrantResume {
  fields: GrantFormFields;
  /** The chosen event's label — the selector's first page may not carry it. */
  eventLabel: string | null;
}

/**
 * 047 EARS-3…EARS-6, EARS-8 — «Выдать доступ»: a platform administrator grants
 * a staff role to a person by email.
 *
 * Approved-non-canvas source `feature-047-staff-access-v1` (owner «1»,
 * #2901): the form opens the way «Добавить участника» opens on the congress
 * roster — the DS `Sheet` side panel, the list visible beside it on a wide
 * screen, a full cover below `lg`. Its states:
 *
 *  - `staff-access-grant-form` — «Почта», «ФИО», «Роль»; «Мероприятие» appears
 *    only for a congress role. Client validation is the SSOT request schema.
 *  - `staff-access-temp-password` — a new account (or one without a password):
 *    the temporary password, shown once in the panel with «Скопировать» and the
 *    line that it will not be shown again. Closing the panel ends the display;
 *    the password is held in this component's state only.
 *  - `staff-access-existing-account` — the role was added to an existing
 *    account: «Роль добавлена к существующей учётной записи», no password.
 *  - `staff-access-refused` / `staff-access-refused-unverified` — the refusal at
 *    the form, the entered values kept, nothing changed.
 *  - `staff-access-step-up` — a second factor older than 30 minutes: the request
 *    is saved, the operator enters a code on the existing code screen and comes
 *    back here, where the page hands the saved request in as `resume` and it is
 *    sent once more. A second step-up refusal of that retry is shown as a
 *    refusal, never another round trip.
 */
export function StaffAccessGrantForm({
  rows,
  onGranted,
  resume,
}: {
  /** The loaded list — names the event of a registrar bound elsewhere. */
  rows: readonly StaffAccessRow[];
  /** A grant went through: the page re-reads the list. */
  onGranted: () => void;
  /** A grant interrupted by the step-up, to restore and send once. */
  resume: StaffAccessGrantResume | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<GrantRefusal | null>(null);
  const [outcome, setOutcome] = useState<GrantOutcome | null>(null);
  const [eventLabel, setEventLabel] = useState<string | null>(null);
  const [eventsFailed, setEventsFailed] = useState(false);
  const { mutate, mutation } = useCustomMutation();
  // The attempt the panel is still waiting for — a late answer after the panel
  // closed cannot paint onto the next, freshly reset panel.
  const attempt = useRef(0);

  const resolver = useCallback<Resolver<GrantFormFields>>(
    async (values) => {
      const issues = grantFormIssues(values);
      const entries = Object.entries(issues);
      if (entries.length === 0) return { values, errors: {} };
      return {
        values: {},
        errors: Object.fromEntries(
          entries.map(([field, issue]) => [
            field,
            {
              type: issue,
              message: t(`staffAccess.grant.validation.${issue}`),
            },
          ]),
        ),
      };
    },
    [t],
  );
  const form = useForm<GrantFormFields>({
    mode: "onTouched",
    resolver,
    defaultValues: GRANT_FORM_EMPTY,
  });
  const role = form.watch("role");

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      attempt.current += 1;
      form.reset(GRANT_FORM_EMPTY);
      setRefusal(null);
      setOutcome(null);
      setEventLabel(null);
      setEventsFailed(false);
    }
  }

  function send(values: GrantFormFields, retry: boolean) {
    const body = grantRequestOf(values);
    if (!body) return;
    const mine = ++attempt.current;
    const current = () => attempt.current === mine;
    setRefusal(null);
    mutate(
      { url: STAFF_ACCESS_GRANTS_PATH, method: "post", values: body },
      {
        onSuccess: ({ data }) => {
          const answer = grantOutcome(data);
          // The grant went through whatever the panel shows now.
          onGranted();
          if (!current()) return;
          if (!answer) {
            setRefusal({ kind: "generic" });
            return;
          }
          setOutcome(answer);
        },
        onError: (error) => {
          if (!current()) return;
          const next = grantRefusal(error, { email: body.email, rows });
          if (next.kind === "stepUp" && !retry) {
            const href = stepUpChallengeHref(
              next.stepUpUrl,
              STAFF_ACCESS_ROUTE,
              STAFF_ACCESS_GRANT_ENDPOINT,
            );
            if (href) {
              saveStepUpRequest(browserStepUpStorage(), {
                method: "POST",
                path: STAFF_ACCESS_GRANTS_PATH,
                body,
                context: { fields: values, eventLabel },
              });
              router.push(href);
              return;
            }
          }
          setRefusal(next);
        },
      },
    );
  }

  // Back from the code screen: restore the interrupted grant and send it once.
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    setOpen(true);
    form.reset(resume.fields);
    setEventLabel(resume.eventLabel);
    send(resume.fields, true);
    // `send` closes over the latest render; this runs once per resume.
  }, [resume]);

  const submitting = mutation.isPending || form.formState.isSubmitting;

  const refusalText = (value: GrantRefusal): string => {
    switch (value.kind) {
      case "unverified":
        return t("staffAccess.grant.errors.unverified");
      case "alreadyComplete":
        return t("staffAccess.grant.errors.alreadyComplete");
      case "boundElsewhere":
        return value.eventTitle
          ? t("staffAccess.grant.errors.boundElsewhere", {
              event: value.eventTitle,
            })
          : t("staffAccess.grant.errors.boundElsewhereUnnamed");
      case "eventNotFound":
        return t("staffAccess.grant.errors.eventNotFound");
      case "unavailable":
        return t("staffAccess.grant.errors.unavailable");
      case "stepUp":
        return t("staffAccess.grant.errors.stepUpAgain");
      case "forbidden":
        return t("login.errorForbidden");
      case "invalid":
        return t("staffAccess.grant.errors.invalid");
      default:
        return t("staffAccess.grant.errors.generic");
    }
  };

  const textField = (
    name: "email" | "fullName",
    label: string,
    options: { type?: string; autoComplete?: string; hint?: string } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`staff-access-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input
              id={`staff-access-${name}`}
              data-testid={`staff-access-${name}`}
              type={options.type ?? "text"}
              autoComplete={options.autoComplete ?? "off"}
              {...field}
            />
          </FormControl>
          {options.hint ? (
            <FormMessage>{options.hint}</FormMessage>
          ) : (
            <FormMessage />
          )}
        </FormItem>
      )}
    />
  );

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button data-testid="staff-access-grant-open">
          {t("staffAccess.grant.trigger")}
        </Button>
      </SheetTrigger>
      <SheetContent size="md" data-testid="staff-access-grant-panel">
        <SheetHeader>
          <SheetTitle>
            {outcome
              ? t("staffAccess.grant.result.title")
              : t("staffAccess.grant.title")}
          </SheetTitle>
          <SheetDescription>
            {outcome
              ? t("staffAccess.grant.result.summary", {
                  name: outcome.row.fullName ?? outcome.row.email ?? "",
                  role: t(staffAccessRoleLabelKey(outcome.row.role)),
                })
              : t("staffAccess.grant.description")}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {outcome?.kind === "password" ? (
            <TemporaryPassword password={outcome.password} />
          ) : outcome?.kind === "existing" ? (
            <Alert
              variant="success"
              data-testid="staff-access-existing-account"
            >
              <p>
                <b>{t("staffAccess.grant.result.existing")}</b>
              </p>
              <p>{t("staffAccess.grant.result.existingDetail")}</p>
            </Alert>
          ) : (
            <Form {...form}>
              <form
                id={FORM_ID}
                className="flex flex-col gap-6"
                data-testid="staff-access-grant-form"
                noValidate
                onSubmit={form.handleSubmit((values) => send(values, false))}
              >
                {textField("email", t("staffAccess.grant.fields.email"), {
                  type: "email",
                })}
                {textField("fullName", t("staffAccess.grant.fields.fullName"), {
                  hint: t("staffAccess.grant.fields.fullNameHint"),
                })}
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="staff-access-role">
                        {t("staffAccess.grant.fields.role")}
                      </FormLabel>
                      <FormControl>
                        <NativeSelect
                          id="staff-access-role"
                          data-testid="staff-access-role"
                          {...field}
                          onChange={(event) => {
                            field.onChange(event);
                            if (
                              !staffAccessRoleTakesEvent(event.target.value)
                            ) {
                              form.setValue("eventId", "");
                              form.clearErrors("eventId");
                              setEventLabel(null);
                            }
                          }}
                        >
                          <option value="">
                            {t("staffAccess.grant.fields.rolePlaceholder")}
                          </option>
                          {STAFF_ACCESS_ROLES.map((value) => (
                            <option key={value} value={value}>
                              {t(staffAccessRoleLabelKey(value))}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {staffAccessRoleTakesEvent(role) ? (
                  <FormField
                    control={form.control}
                    name="eventId"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel htmlFor="staff-access-event">
                          {t("staffAccess.grant.fields.event")}
                        </FormLabel>
                        <FormControl ref={field.ref}>
                          <EventCombobox
                            value={field.value || null}
                            savedLabel={eventLabel}
                            onValueChange={(id, label) => {
                              field.onChange(id ?? "");
                              field.onBlur();
                              setEventLabel(label);
                            }}
                            invalid={fieldState.invalid}
                            onFailed={setEventsFailed}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                {eventsFailed ? (
                  <FormError data-testid="staff-access-events-error">
                    {t("staffAccess.grant.fields.eventsFailed")}
                  </FormError>
                ) : null}
                {refusal ? (
                  <FormError
                    data-testid="staff-access-grant-error"
                    data-refusal={refusal.kind}
                  >
                    {refusalText(refusal)}
                  </FormError>
                ) : null}
              </form>
            </Form>
          )}
        </SheetBody>
        <SheetFooter>
          {outcome ? (
            <SheetClose asChild>
              <Button type="button" data-testid="staff-access-grant-done">
                {t("staffAccess.grant.result.done")}
              </Button>
            </SheetClose>
          ) : (
            <>
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
              </SheetClose>
              <Button
                type="submit"
                form={FORM_ID}
                loading={submitting}
                disabled={submitting}
                data-testid="staff-access-grant-submit"
              >
                {t("staffAccess.grant.submit")}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * EARS-6 — the temporary password, once: a read-only field, «Скопировать», and
 * the line that it will not be shown again.
 */
function TemporaryPassword({ password }: { password: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="staff-access-temp-password"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-access-password">
          {t("staffAccess.grant.result.passwordLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="staff-access-password"
            data-testid="staff-access-password"
            readOnly
            value={password}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            data-testid="staff-access-password-copy"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(password)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied
              ? t("staffAccess.grant.result.copied")
              : t("staffAccess.grant.result.copy")}
          </Button>
        </div>
      </div>
      <Alert variant="warn" data-testid="staff-access-password-warning">
        {t("staffAccess.grant.result.passwordWarning")}
      </Alert>
    </div>
  );
}

/**
 * The «Мероприятие» selector: the operator event list searched on the server
 * through the shared server-combobox hook; an option reads «название · дата».
 */
function EventCombobox({
  value,
  savedLabel,
  onValueChange,
  invalid,
  onFailed,
  ...slot
}: SlotProps & {
  value: string | null;
  /** The label of a value restored after the step-up. */
  savedLabel: string | null;
  onValueChange: (id: string | null, label: string | null) => void;
  invalid: boolean;
  onFailed: (failed: boolean) => void;
}) {
  const t = useTranslations();
  const fetchPage = useCallback(
    (args: { q: string; page: number; pageSize: number }) =>
      fetchStaffAccessEventPage(args),
    [],
  );
  const events = useServerCombobox({
    fetchPage,
    toOption: (event) => ({ id: event.id, label: event.label }),
    selectedId: value,
  });
  const failed = events.isError;
  useEffect(() => onFailed(failed), [failed, onFailed]);

  const options = useMemo<ComboboxOption[]>(() => {
    if (
      value &&
      savedLabel &&
      !events.options.some((option) => option.value === value)
    ) {
      return [{ value, label: savedLabel }, ...events.options];
    }
    return events.options;
  }, [events.options, savedLabel, value]);

  return (
    <Combobox
      id="staff-access-event"
      data-testid="staff-access-event"
      options={options}
      value={value}
      onValueChange={(next) => {
        events.select(next);
        onValueChange(
          next,
          options.find((option) => option.value === next)?.label ?? null,
        );
      }}
      onSearchChange={events.search}
      onLoadMore={events.loadMore}
      hasMore={events.hasMore}
      loadingMore={events.loadingMore}
      loadMoreError={events.loadMoreError}
      loadMoreLabel={t("relationshipEndpointPicker.loadMore")}
      loadingMoreLabel={t("relationshipEndpointPicker.loadingMore")}
      loadMoreErrorLabel={t("relationshipEndpointPicker.retryLoadMore")}
      placeholder={
        events.isLoading && events.options.length === 0
          ? t("staffAccess.grant.fields.eventLoading")
          : t("staffAccess.grant.fields.eventPlaceholder")
      }
      searchLabel={t("staffAccess.grant.fields.eventSearch")}
      searchPlaceholder={t("staffAccess.grant.fields.eventSearchPlaceholder")}
      emptyLabel={t("staffAccess.grant.fields.eventEmpty")}
      showSearch
      invalid={invalid}
      {...slot}
    />
  );
}
