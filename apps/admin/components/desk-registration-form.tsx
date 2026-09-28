"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Link as DsLink,
} from "@ds/design-system";
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
import {
  Combobox,
  FormSection,
  type ComboboxOption,
} from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  CongressDeskRegistrationResponseSchema,
  type CongressDeskRegistrationRequest,
} from "@ds/schemas";
import { deskEntryFailure } from "@/lib/congress-roster";
import { fetchSpecialtySearchPage } from "@/lib/desk-entry-references";
import {
  DeskRegistrationFormSchema,
  type DeskRegistrationFormFields,
} from "@/lib/form-schemas";
import {
  freeSettlementText,
  freeSettlementValue,
  resolveSettlement,
  settlementOption,
  settlementOptions,
  type SettlementResolution,
} from "@/lib/settlements";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useServerCombobox } from "@/lib/use-server-combobox";
import { congressRosterUrl } from "@/providers/data-provider";

type DeskForm = UseFormReturn<DeskRegistrationFormFields>;

/** The form lives in the panel body, its actions in the footer: one id joins them. */
const FORM_ID = "desk-entry-form";

/**
 * 044 EARS-35 — the registrar's desk entry: a walk-in participant entered from
 * the roster screen and sent through the SAME intake use-case as the site form
 * (`POST /v1/admin/events/:idOrSlug/registrations`).
 *
 * Approved-non-canvas source `feature-044-desk-registration-form-v1`, state
 * `desk-entry-panel` (owner Stage-B round 1, #2377): the form opens in the DS
 * `Sheet` side panel — the roster stays visible and usable beside it on a wide
 * screen, a full cover below `lg` — and every reference field searches: the
 * specialty over the closed book (server search), the settlement over the
 * bundled ОКТМО directory the congress site uses, a pick filling the region.
 * Its states:
 *
 *  - `desk-entry-form` — the form; client validation IS the SSOT desk request,
 *    so the browser refuses what the API refuses.
 *  - `desk-entry-accepted` — the panel closes and the page refetches the roster
 *    and names the added participant (`onAccepted`).
 *  - `desk-entry-existing` — this email is already registered for the event
 *    (EARS-8): the panel stays open and an info `Alert` at the top of the body
 *    (focused, so it scrolls into view) names the address, says no new record
 *    was made and links to that registration's
 *    row; it clears when the email changes or the panel closes. It never says
 *    whether the ACCOUNT existed — the response cannot say it.
 *  - `desk-entry-refused-no-consent` — the unticked paper-consent box: the
 *    field's own message, and no request is sent.
 *
 * A withdrawn grant (403) hands the screen back to the page (`onGrantWithdrawn`)
 * and is never retried; an IdP outage (503) and every other refusal keep the
 * typed values so the registrar can simply submit again.
 */
export function DeskRegistrationForm({
  eventId,
  onAccepted,
  onGrantWithdrawn,
}: {
  eventId: string;
  onAccepted: (participantName: string) => void;
  onGrantWithdrawn: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [specialtiesFailed, setSpecialtiesFailed] = useState(false);
  const { mutate, mutation } = useCustomMutation();
  // The attempt the panel is still waiting for. Closing the panel (or a new
  // submit) moves it on, so an answer that lands late — after Esc / «Отмена» —
  // cannot paint its line onto the next, freshly reset panel.
  const attempt = useRef(0);

  const form = useForm<DeskRegistrationFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      DeskRegistrationFormSchema as unknown as z.ZodType<
        DeskRegistrationFormFields,
        DeskRegistrationFormFields
      >,
      "congressRoster.deskEntry.validation",
    ),
    defaultValues: {
      surname: "",
      firstName: "",
      patronymic: "",
      email: "",
      specialtyId: "",
      workplace: "",
      city: "",
      region: "",
      contactPhone: "",
      paperConsent: false,
    },
  });

  // The «already registered» notice is the answer to the submit: it takes the
  // focus (and so scrolls into view at the top of the body) the moment it
  // appears, and it stops being true once the registrar edits the address.
  const existingNotice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!existingEmail) return;
    existingNotice.current?.focus();
    const watcher = form.watch((values, { name }) => {
      if (name === "email" && values.email !== existingEmail) {
        setExistingEmail(null);
      }
    });
    return () => watcher.unsubscribe();
  }, [existingEmail, form]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      attempt.current += 1;
      form.reset();
      setExistingEmail(null);
      setRefusal(null);
      setSpecialtiesFailed(false);
    }
  }
  function submit(values: DeskRegistrationFormFields) {
    // The resolver's output is the SSOT request (the empty patronymic already
    // dropped); the field type is the box shape, hence the one cast.
    const body = values as unknown as CongressDeskRegistrationRequest;
    const mine = ++attempt.current;
    const current = () => attempt.current === mine;
    setExistingEmail(null);
    setRefusal(null);
    mutate(
      {
        url: congressRosterUrl.deskRegistration(eventId),
        method: "post",
        values: body,
      },
      {
        onSuccess: ({ data }) => {
          const answer = CongressDeskRegistrationResponseSchema.safeParse(data);
          if (!answer.success) {
            if (current()) {
              setRefusal(t("congressRoster.deskEntry.errors.generic"));
            }
            return;
          }
          if (answer.data.status === "existing") {
            if (current()) setExistingEmail(body.email);
            return;
          }
          // A registration was written: the roster names it even when the
          // panel was closed meanwhile — that is the page's truth, not the
          // panel's state.
          if (current()) changeOpen(false);
          onAccepted(
            [body.surname, body.firstName, body.patronymic]
              .filter(Boolean)
              .join(" "),
          );
        },
        onError: (error) => {
          const failure = deskEntryFailure(error);
          if (failure === "grantWithdrawn") {
            // The grant is gone whether or not the panel is still open.
            if (current()) changeOpen(false);
            onGrantWithdrawn();
            return;
          }
          if (!current()) return;
          switch (failure) {
            case "revalidationUnavailable":
              setRefusal(t("congressRoster.deskEntry.errors.revalidation"));
              return;
            case "noConsent":
              setRefusal(t("congressRoster.deskEntry.errors.noConsent"));
              return;
            default:
              setRefusal(t("congressRoster.deskEntry.errors.generic"));
          }
        },
      },
    );
  }

  // `isSubmitting` also covers the async resolver's window before the request
  // leaves, so a double click cannot queue a second entry.
  const submitting = mutation.isPending || form.formState.isSubmitting;

  const textField = (
    name: Exclude<
      keyof DeskRegistrationFormFields,
      "paperConsent" | "specialtyId"
    >,
    label: string,
    options: { type?: string; autoComplete?: string; hint?: string } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`desk-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input
              id={`desk-${name}`}
              data-testid={`desk-${name}`}
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
        <Button data-testid="desk-entry-open">
          {t("congressRoster.deskEntry.trigger")}
        </Button>
      </SheetTrigger>
      <SheetContent size="md" data-testid="desk-entry-panel">
        <SheetHeader>
          <SheetTitle>{t("congressRoster.deskEntry.title")}</SheetTitle>
          <SheetDescription>
            {t("congressRoster.deskEntry.description")}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {existingEmail ? (
            <Alert
              ref={existingNotice}
              variant="info"
              className="mb-6"
              tabIndex={-1}
              data-testid="desk-entry-existing"
            >
              <p data-testid="desk-entry-existing-title">
                <b>{t("congressRoster.deskEntry.existingTitle")}</b>
              </p>
              <p>
                {t.rich("congressRoster.deskEntry.existing", {
                  email: existingEmail,
                  b: (chunks) => <b>{chunks}</b>,
                })}{" "}
                <DsLink asChild variant="inline">
                  <Link
                    href={`/events/${encodeURIComponent(eventId)}/roster?q=${encodeURIComponent(existingEmail)}`}
                    data-testid="desk-entry-open-existing"
                    onClick={() => changeOpen(false)}
                  >
                    {t("congressRoster.deskEntry.openExisting")}
                  </Link>
                </DsLink>
              </p>
            </Alert>
          ) : null}
          <Form {...form}>
            <form
              id={FORM_ID}
              className="flex flex-col gap-6"
              data-testid="desk-entry-form"
              noValidate
              onSubmit={form.handleSubmit(submit)}
            >
              <FormSection
                legend={t("congressRoster.deskEntry.sections.participant")}
              >
                {textField(
                  "surname",
                  t("congressRoster.deskEntry.fields.surname"),
                )}
                {textField(
                  "firstName",
                  t("congressRoster.deskEntry.fields.firstName"),
                )}
                {textField(
                  "patronymic",
                  t("congressRoster.deskEntry.fields.patronymic"),
                  { hint: t("congressRoster.deskEntry.fields.patronymicHint") },
                )}
                {textField("email", t("congressRoster.deskEntry.fields.email"), {
                  type: "email",
                })}
                {textField(
                  "contactPhone",
                  t("congressRoster.deskEntry.fields.phone"),
                  { type: "tel" },
                )}
                <SpecialtyField
                  form={form}
                  onBookFailed={setSpecialtiesFailed}
                />
                {textField(
                  "workplace",
                  t("congressRoster.deskEntry.fields.workplace"),
                )}
                <SettlementFields form={form} />
              </FormSection>
  
              <FormSection
                legend={t("congressRoster.deskEntry.sections.consent")}
              >
                <FormField
                  control={form.control}
                  name="paperConsent"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Checkbox
                          id="desk-paperConsent"
                          data-testid="desk-paperConsent"
                          checked={field.value}
                          name={field.name}
                          onBlur={field.onBlur}
                          onChange={(e) => field.onChange(e.target.checked)}
                          ref={field.ref}
                        >
                          {t("congressRoster.deskEntry.fields.paperConsent")}
                        </Checkbox>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormSection>
  
              {specialtiesFailed ? (
                <FormError data-testid="desk-entry-book-error">
                  {t("congressRoster.deskEntry.errors.specialtiesFailed")}
                </FormError>
              ) : null}
              {refusal ? (
                <FormError data-testid="desk-entry-error">{refusal}</FormError>
              ) : null}
            </form>
          </Form>
        </SheetBody>
        <SheetFooter>
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
            data-testid="desk-entry-submit"
          >
            {t("congressRoster.deskEntry.submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * «Специальность» — the closed book, searched on the server. Mounted with the
 * panel body, so the book is read when the panel opens (the first, empty
 * search), and each typing pause sends one `?q=` narrowing through the shared
 * server-combobox hook. The value is the specialty id.
 */
function SpecialtyField({
  form,
  onBookFailed,
}: {
  form: DeskForm;
  onBookFailed: (failed: boolean) => void;
}) {
  const t = useTranslations();
  const fetchPage = useCallback(
    ({ q }: { q: string }) => fetchSpecialtySearchPage({ q }),
    [],
  );
  const selectedId = form.watch("specialtyId");
  const specialties = useServerCombobox({
    fetchPage,
    toOption: (entry) => ({ id: entry.id, label: entry.name }),
    selectedId: selectedId || null,
  });
  // The book failure is the panel's line (beside the other refusals), so it is
  // reported up rather than drawn here.
  const failed = specialties.isError;
  useEffect(() => onBookFailed(failed), [failed, onBookFailed]);

  return (
    <FormField
      control={form.control}
      name="specialtyId"
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel htmlFor="desk-specialtyId">
            {t("congressRoster.deskEntry.fields.specialty")}
          </FormLabel>
          <FormControl>
            <Combobox
              ref={field.ref}
              id="desk-specialtyId"
              data-testid="desk-specialtyId"
              options={specialties.options}
              value={field.value || null}
              onValueChange={(id) => {
                specialties.select(id);
                field.onChange(id);
                field.onBlur();
              }}
              onSearchChange={specialties.search}
              placeholder={
                specialties.isLoading && specialties.options.length === 0
                  ? t("congressRoster.deskEntry.fields.specialtyLoading")
                  : t("congressRoster.deskEntry.fields.specialtyPlaceholder")
              }
              searchLabel={t("congressRoster.deskEntry.fields.specialtySearch")}
              searchPlaceholder={t(
                "congressRoster.deskEntry.fields.specialtySearchPlaceholder",
              )}
              emptyLabel={t("congressRoster.deskEntry.fields.referenceEmpty")}
              showSearch
              invalid={fieldState.invalid}
            />
          </FormControl>
          <FormMessage>
            {t("congressRoster.deskEntry.fields.specialtyHint")}
          </FormMessage>
        </FormItem>
      )}
    />
  );
}

/**
 * «Населённый пункт» + «Регион», mirroring the congress site's form: the place
 * is searched in the bundled directory (names BEGINNING with what was typed,
 * capped); a pick fills the region silently and shows it under the field
 * («Химки» → «Московская область»). A place the directory does not hold — or
 * holds in several regions — is taken as typed through the list's last option,
 * and only then does the «Регион» field appear, empty, with the reason.
 */
function SettlementFields({ form }: { form: DeskForm }) {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [resolution, setResolution] = useState<SettlementResolution | null>(
    null,
  );

  const options = useMemo(() => {
    const found = settlementOptions(query);
    const typed = query.trim();
    const free: ComboboxOption[] = typed
      ? [
          {
            value: freeSettlementValue(typed),
            label: t("congressRoster.deskEntry.fields.cityFree", {
              name: typed,
            }),
          },
        ]
      : [];
    // The committed choice stays an option, so the closed control keeps
    // reading it while a new search narrows the list away from it.
    const current = choice ? chosenOption(choice) : null;
    const kept =
      current && !found.some((option) => option.value === current.value)
        ? [current]
        : [];
    return [...kept, ...found, ...free];
  }, [choice, query, t]);

  function commit(value: string) {
    const next = resolveSettlement(value);
    if (!next) return;
    // A typed place is kept in the spelling the form stores (the directory's,
    // when the text named exactly one of its places).
    setChoice(
      freeSettlementText(value) === null ? value : freeSettlementValue(next.city),
    );
    setResolution(next);
    form.setValue("city", next.city, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue("region", next.region, {
      shouldDirty: true,
      shouldValidate: next.regionField === null,
    });
  }

  const regionReason = resolution?.regionField ?? null;

  return (
    <>
      <FormField
        control={form.control}
        name="city"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel htmlFor="desk-city">
              {t("congressRoster.deskEntry.fields.city")}
            </FormLabel>
            <FormControl>
              <Combobox
                ref={field.ref}
                id="desk-city"
                data-testid="desk-city"
                options={options}
                value={choice}
                onValueChange={commit}
                onSearchChange={setQuery}
                placeholder={t("congressRoster.deskEntry.fields.cityPlaceholder")}
                searchLabel={t("congressRoster.deskEntry.fields.citySearch")}
                searchPlaceholder={t(
                  "congressRoster.deskEntry.fields.cityPlaceholder",
                )}
                emptyLabel={t("congressRoster.deskEntry.fields.referenceEmpty")}
                showSearch
                invalid={fieldState.invalid}
              />
            </FormControl>
            {resolution?.hint ? (
              <FormMessage data-testid="desk-city-hint">
                {resolution.hint}
              </FormMessage>
            ) : (
              <FormMessage />
            )}
          </FormItem>
        )}
      />
      {regionReason ? (
        <FormField
          control={form.control}
          name="region"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="desk-region">
                {t("congressRoster.deskEntry.fields.region")}
              </FormLabel>
              <FormControl>
                <Input
                  id="desk-region"
                  data-testid="desk-region"
                  autoComplete="address-level1"
                  placeholder={t(
                    "congressRoster.deskEntry.fields.regionPlaceholder",
                  )}
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {regionReason === "ambiguous"
                  ? t("congressRoster.deskEntry.fields.regionHintAmbiguous")
                  : t("congressRoster.deskEntry.fields.regionHintUnknown")}
              </FormMessage>
            </FormItem>
          )}
        />
      ) : null}
      {/* The «Регион» field appears silently for a screen reader; this line
          is announced (the congress site's own reveal copy). */}
      <p className="sr-only" role="status" data-testid="desk-region-status">
        {regionReason
          ? t("congressRoster.deskEntry.fields.regionAdded", {
              hint:
                regionReason === "ambiguous"
                  ? t("congressRoster.deskEntry.fields.regionHintAmbiguous")
                  : t("congressRoster.deskEntry.fields.regionHintUnknown"),
            })
          : ""}
      </p>
    </>
  );
}

/** The option a committed value reads as: its directory entry, or the typed text. */
function chosenOption(value: string): ComboboxOption | null {
  const free = freeSettlementText(value);
  if (free !== null) return { value, label: free };
  return settlementOption(value);
}
