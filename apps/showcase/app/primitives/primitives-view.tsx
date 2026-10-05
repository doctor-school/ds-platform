"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";

import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import { Input } from "@ds/design-system/input";
import { NativeSelect } from "@ds/design-system/native-select";
import { Textarea } from "@ds/design-system/textarea";
import { MediaDropzone } from "@ds/design-system/media-dropzone";
import { Label } from "@ds/design-system/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@ds/design-system/input-otp";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ds/design-system/dialog";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  type SheetNavigateDirection,
} from "@ds/design-system/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ds/design-system/alert-dialog";
import { FilterChip } from "@ds/design-system/filter-chip";
import { Badge } from "@ds/design-system/badge";
import { Avatar } from "@ds/design-system/avatar";
import { Checkbox } from "@ds/design-system/checkbox";
import { Radio } from "@ds/design-system/radio";
import { Switch } from "@ds/design-system/switch";
import { Alert } from "@ds/design-system/alert";
import { Skeleton } from "@ds/design-system/skeleton";
import { ContactChip } from "@ds/design-system/contact-chip";
import { DayBand } from "@ds/design-system/day-band";
import { WebinarCard } from "@ds/design-system/webinar-card";
import { WebinarPageContent } from "@ds/design-system/webinar-page-content";
import { WebinarStatusCard } from "@ds/design-system/webinar-status-card";
import { RecordingSpoiler } from "@ds/design-system/recording-spoiler";
import { WebinarRecordingPlaque } from "@ds/design-system/webinar-recording-plaque";
import { WebinarRoomLayout } from "@ds/design-system/webinar-room";
import { Container } from "@ds/design-system/container";
import {
  EventsFilter,
  defaultAppliedFacets,
  type AppliedFacets,
  type EventsFilterHost,
  type EventsFilterLabels,
  type EventsFilterOptions,
} from "@ds/design-system/events-filter";
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormErrorSummary,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  EmailField,
  IdentifierField,
  OtpField,
  PasswordField,
  PhoneField,
} from "@ds/design-system/fields";

/**
 * Primitives section (design-system-showcase spec §3.2). Every exported
 * `@ds/design-system` primitive is rendered as the REAL component across its
 * states × variants × sizes, with an explicit **states column**. The showcase
 * re-implements nothing (spec §2.4) — it imports the same exports the product
 * apps consume.
 *
 * Pointer-driven states (hover / focus / active) cannot be expressed by a prop;
 * each such cell carries `data-showcase-force="<state>"` so the retargeted
 * Playwright + axe capture (#351) forces the matching pseudo-state via CDP
 * (`CSS.forcePseudoState`, probed in isolation per the forced-pseudo-state
 * discipline). The static states (default / disabled / error) render from real
 * props, and the live interactive sample at the top of each section lets a human
 * exercise the pointer states directly.
 */

const POINTER_STATES = new Set(["hover", "focus", "active"]);

/**
 * Statically-forced focus ring — applied to the `focus` state cell so the ring
 * is visible on a static read (and screenshot) without tabbing, instead of a
 * pointer-only state. It MIRRORS the neo-brutalist focus contract every re-skinned
 * primitive now carries (#512): the flush 3px `shadow-focus` ring (source global
 * `:focus-visible` 3px blue outline), applied here unconditionally (no
 * `focus-visible:` prefix) so it paints on a static read.
 *
 * Written as a LITERAL (not a runtime-computed string): Tailwind's content
 * scanner only emits utilities it sees as literal strings. `shadow-focus`
 * resolves to the `--shadow-focus` token, so the ring stays token-driven and
 * matches the real focus ring; keep this in sync if that token ever changes.
 */
const FORCED_FOCUS = "outline-none shadow-focus";

type StateSpec = { name: string; note?: string };

/** One labelled column per state; pointer states are tagged for the CDP capture. */
function StateColumns({
  states,
  render,
}: {
  states: StateSpec[];
  render: (state: string) => ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      {states.map((s) => (
        <div key={s.name} className="flex flex-col items-start gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            {s.name}
          </span>
          <div
            data-showcase-force={
              POINTER_STATES.has(s.name) ? s.name : undefined
            }
          >
            {render(s.name)}
          </div>
          {s.note ? (
            // muted-foreground at full strength (the AA-safe quiet tier, #270);
            // an opacity modifier (`/70`) dims it below the WCAG-AA threshold and
            // is caught by the retargeted axe scan (#351).
            <span className="max-w-48 text-xs text-muted-foreground">
              {s.note}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Section frame: a titled block with an optional export-name caption. */
function PrimitiveSection({
  title,
  exportsLine,
  children,
}: {
  title: string;
  exportsLine: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <code className="font-mono text-xs text-muted-foreground">
          {exportsLine}
        </code>
      </div>
      {children}
    </section>
  );
}

/** Sub-heading inside a section (a variant row, a sizes row, …). */
function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

const INTERACTIVE_STATES: StateSpec[] = [
  { name: "default" },
  { name: "hover", note: "hover the cell / forced via CDP (#351)" },
  { name: "focus", note: "ring forced (mirrors interactiveBase)" },
  { name: "active", note: "press the cell / forced via CDP (#351)" },
  { name: "disabled" },
];

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;
const BUTTON_SIZES = ["default", "sm", "lg", "icon"] as const;

function ButtonSection() {
  return (
    <PrimitiveSection
      title="Button"
      exportsLine="Button · buttonVariants — variant × size × state"
    >
      <SubRow label="Live sample (hover / focus / press me)">
        <Button>Click me</Button>
      </SubRow>

      {BUTTON_VARIANTS.map((variant) => (
        <SubRow key={variant} label={`variant="${variant}"`}>
          <StateColumns
            states={INTERACTIVE_STATES}
            render={(state) => (
              <Button
                variant={variant}
                disabled={state === "disabled"}
                className={state === "focus" ? FORCED_FOCUS : undefined}
              >
                {variant === "link" ? "Link button" : "Button"}
              </Button>
            )}
          />
        </SubRow>
      ))}

      <SubRow label='variant="on-primary" — invariant primary surface'>
        <StateColumns
          states={INTERACTIVE_STATES}
          render={(state) => (
            <div
              data-testid={`button-on-primary-surface-${state}`}
              className="bg-primary-surface p-4"
            >
              <Button
                data-testid={`button-on-primary-${state}`}
                variant="on-primary"
                disabled={state === "disabled"}
                className={state === "focus" ? FORCED_FOCUS : undefined}
              >
                Button
              </Button>
            </div>
          )}
        />
        <div className="w-fit bg-primary-surface p-4">
          <Button variant="on-primary" loading>
            Saving…
          </Button>
        </div>
      </SubRow>

      <SubRow label="Sizes (variant=default)">
        <div className="flex flex-wrap items-center gap-4">
          {BUTTON_SIZES.map((size) => (
            <div key={size} className="flex flex-col items-start gap-1.5">
              <span className="font-mono text-xs text-muted-foreground">
                {size}
              </span>
              <Button
                size={size}
                aria-label={size === "icon" ? "icon" : undefined}
              >
                {size === "icon" ? "★" : "Button"}
              </Button>
            </div>
          ))}
        </div>
      </SubRow>

      <SubRow label="loading">
        <Button loading>Saving…</Button>
      </SubRow>
    </PrimitiveSection>
  );
}

const LINK_VARIANTS = ["standalone", "inline"] as const;
const LINK_STATES: StateSpec[] = [
  { name: "default" },
  { name: "hover", note: "hover / CDP #351" },
  { name: "focus", note: "ring forced" },
  { name: "active", note: "press / CDP #351" },
  { name: "disabled", note: 'aria-disabled="true"' },
];

function LinkSection() {
  return (
    <PrimitiveSection
      title="Link"
      exportsLine="Link · linkVariants — variant × state"
    >
      {LINK_VARIANTS.map((variant) => (
        <SubRow key={variant} label={`variant="${variant}"`}>
          <span className="text-sm text-foreground">
            Body copy with a{" "}
            <StateColumnsInline
              states={LINK_STATES}
              render={(state) => (
                <Link
                  href="#"
                  variant={variant}
                  aria-disabled={state === "disabled" || undefined}
                  className={state === "focus" ? FORCED_FOCUS : undefined}
                >
                  {variant} link
                </Link>
              )}
            />{" "}
            inside it.
          </span>
        </SubRow>
      ))}
      <SubRow label='tone="on-primary" — invariant primary surface'>
        <span className="inline-flex flex-wrap items-baseline gap-2 bg-primary-surface p-4 text-primary-surface-foreground">
          Privacy copy with an{" "}
          <StateColumnsInline
            states={LINK_STATES}
            labelTone="on-primary"
            render={(state) => (
              <Link
                href="#"
                variant="inline"
                tone="on-primary"
                aria-disabled={state === "disabled" || undefined}
                className={state === "focus" ? FORCED_FOCUS : undefined}
              >
                inline link
              </Link>
            )}
          />
        </span>
      </SubRow>
    </PrimitiveSection>
  );
}

/** Inline variant of StateColumns for links sitting in running text. */
function StateColumnsInline({
  states,
  labelTone = "default",
  render,
}: {
  states: StateSpec[];
  labelTone?: "default" | "on-primary";
  render: (state: string) => ReactNode;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {states.map((s) => (
        <span key={s.name} className="inline-flex items-baseline gap-1.5">
          <span
            className={
              labelTone === "on-primary"
                ? "font-mono text-xs text-primary-surface-muted"
                : "font-mono text-xs text-muted-foreground"
            }
          >
            {s.name}:
          </span>
          <span
            data-showcase-force={
              POINTER_STATES.has(s.name) ? s.name : undefined
            }
          >
            {render(s.name)}
          </span>
        </span>
      ))}
    </span>
  );
}

const INPUT_STATES: StateSpec[] = [
  { name: "default" },
  { name: "focus", note: "ring forced (mirrors interactiveBase)" },
  { name: "disabled" },
  { name: "error", note: 'aria-invalid="true"' },
];

function InputSection() {
  return (
    <PrimitiveSection title="Input" exportsLine="Input — state">
      <StateColumns
        states={INPUT_STATES}
        render={(state) => (
          <Input
            className={state === "focus" ? `w-48 ${FORCED_FOCUS}` : "w-48"}
            // A bare specimen has no visible <Label>; give it an accessible name
            // so it is not an unlabelled form control (caught by the retargeted
            // axe `label` rule, #351). Real surfaces label via FormField/Label.
            aria-label={`Input sample (${state})`}
            placeholder="you@example.com"
            defaultValue={state === "error" ? "not-an-email" : ""}
            disabled={state === "disabled"}
            aria-invalid={state === "error" || undefined}
          />
        )}
      />
    </PrimitiveSection>
  );
}

const NATIVE_SELECT_ROLES = [
  "Эксперт",
  "Партнёр",
  "Участник подкаста",
  "Соавтор направления",
  "Компания",
] as const;

type NativeSelectState =
  "empty" | "filled" | "hover" | "active" | "focus" | "invalid" | "disabled";

function NativeSelectFieldDemo({ state }: { state: NativeSelectState }) {
  const startsFilled =
    state === "filled" ||
    state === "hover" ||
    state === "active" ||
    state === "focus" ||
    state === "disabled";
  const form = useForm<{ role: string }>({
    defaultValues: { role: startsFilled ? "Партнёр" : "" },
    mode: "onTouched",
  });

  useEffect(() => {
    if (state === "invalid") {
      form.setError("role", { type: "manual", message: "Выберите роль" });
    }
  }, [form, state]);

  return (
    <Form {...form}>
      <form className="w-full" onSubmit={(event) => event.preventDefault()}>
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Роль</FormLabel>
              <FormControl>
                <NativeSelect
                  {...field}
                  required
                  disabled={state === "disabled"}
                  className={state === "focus" ? FORCED_FOCUS : undefined}
                >
                  <option value="" disabled>
                    Выберите роль
                  </option>
                  {NATIVE_SELECT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

function NativeSelectSection() {
  const states: NativeSelectState[] = [
    "empty",
    "filled",
    "hover",
    "active",
    "focus",
    "invalid",
    "disabled",
  ];

  return (
    <PrimitiveSection
      title="NativeSelect"
      exportsLine="NativeSelect — empty · filled · hover · active · focus-visible · invalid · disabled"
    >
      <p className="text-sm text-muted-foreground">
        The official shadcn/ui native-select composition, re-skinned to the
        adjacent Input geometry. The browser retains keyboard arrows,
        type-ahead, form submission, and its mobile picker; the quiet chevron is
        decorative.
      </p>
      <ThemePair
        render={() => (
          <div className="flex w-full flex-col gap-6 text-foreground">
            {states.map((state) => (
              <Cell key={state} label={state}>
                <div
                  data-showcase-force={
                    POINTER_STATES.has(state) ? state : undefined
                  }
                  className="w-full"
                >
                  <NativeSelectFieldDemo state={state} />
                </div>
              </Cell>
            ))}
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

function TextareaSection() {
  const states = [
    "empty",
    "filled",
    "hover",
    "active",
    "focus",
    "over-limit",
    "invalid",
    "disabled",
  ] as const;

  return (
    <PrimitiveSection
      title="Textarea"
      exportsLine="Textarea — empty · filled · hover · active · focus-visible · over-limit · invalid · disabled"
    >
      <p className="text-sm text-muted-foreground">
        The official shadcn/ui textarea, re-skinned to the Input geometry, plus
        the remaining-characters counter the 012 authoring forms need. The
        counter never truncates: over the limit it turns destructive and the
        control reads invalid, which is a truthful «this will be refused»
        instead of silently dropping the operator&apos;s text.
      </p>
      <ThemePair
        render={() => (
          <div className="flex w-full flex-col gap-6 text-foreground">
            {states.map((state) => (
              <Cell key={state} label={state}>
                <div
                  data-showcase-force={
                    POINTER_STATES.has(state) ? state : undefined
                  }
                  className="w-full"
                >
                  {/* No hand-made `id`: `ThemePair` renders this tree ONCE PER
                      THEME PANE, so a literal id would be emitted twice per page.
                      The primitive derives its counter id from `useId()`, which is
                      unique per instance — the same reason every other section
                      keeps ids out of `ThemePair`. */}
                  <Textarea
                    aria-label={`Textarea sample (${state})`}
                    showCounter
                    maxLength={120}
                    formatCounter={(remaining) =>
                      remaining < 0
                        ? `превышено на ${Math.abs(remaining)}`
                        : `осталось ${remaining}`
                    }
                    defaultValue={
                      state === "empty"
                        ? ""
                        : state === "over-limit"
                          ? "Слишком длинное описание проекта, которое заведомо не проходит по границе поля и должно быть честно помечено как превышение лимита."
                          : "Программа для практикующих кардиологов."
                    }
                    disabled={state === "disabled"}
                    aria-invalid={state === "invalid" || undefined}
                    className={state === "focus" ? FORCED_FOCUS : undefined}
                  />
                </div>
              </Cell>
            ))}
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

const DROPZONE_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;

/** A tiny inline SVG stand-in for a stored cover — no network, no fixture file. */
const DROPZONE_PREVIEW =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMWQ0ZWQ4Ii8+PC9zdmc+";

const DROPZONE_LABELS = {
  prompt: "Перетащите изображение или выберите файл",
  hint: "JPEG, PNG или WebP · до 10 МБ · до 6000 px по стороне",
  remove: "убрать",
  previewAlt: "Текущее изображение",
};

type DropzoneState =
  "empty" | "hover" | "active" | "focus" | "filled" | "disabled";

/**
 * One dropzone specimen. `MediaDropzone` REQUIRES an `id` (it names the hidden
 * file input), and `ThemePair` renders its tree once per theme pane — so the id
 * comes from `useId()` on this component, giving each pane its own unique value
 * instead of one literal emitted twice per page.
 */
function MediaDropzoneSpecimen({ state }: { state: DropzoneState }) {
  const id = useId();
  return (
    <MediaDropzone
      id={id}
      accept={DROPZONE_ACCEPT}
      maxBytes={10 * 1024 * 1024}
      currentUrl={state === "filled" ? DROPZONE_PREVIEW : null}
      file={null}
      onFileChange={() => undefined}
      onRemoveCurrent={() => undefined}
      disabled={state === "disabled"}
      labels={DROPZONE_LABELS}
      className={state === "focus" ? FORCED_FOCUS : undefined}
    />
  );
}

function MediaDropzoneSection() {
  const states: DropzoneState[] = [
    "empty",
    "hover",
    "active",
    "focus",
    "filled",
    "disabled",
  ];
  return (
    <PrimitiveSection
      title="MediaDropzone"
      exportsLine="MediaDropzone — empty · hover · active · focus-visible · filled (preview + убрать) · disabled"
    >
      <p className="text-sm text-muted-foreground">
        Adopted from the Kibo UI Dropzone pattern (MIT), re-skinned to DS tokens
        and reduced to one optional image. The whole zone is a
        <code> label </code> around a visually-hidden file input, so Tab reaches
        a real control and Space opens the picker. Its type/size checks are
        preflight only — the API normalizer stays authoritative.
      </p>
      <ThemePair
        render={() => (
          <div className="flex w-full flex-col gap-6 text-foreground">
            {states.map((state) => (
              <Cell key={state} label={state}>
                <div
                  data-showcase-force={
                    POINTER_STATES.has(state) ? state : undefined
                  }
                  className="w-full"
                >
                  <MediaDropzoneSpecimen state={state} />
                </div>
              </Cell>
            ))}
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

function LabelSection() {
  return (
    <PrimitiveSection
      title="Label"
      exportsLine="Label — default / peer-disabled"
    >
      <div className="flex flex-wrap gap-8">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            default
          </span>
          <Label htmlFor="label-demo-default">Email address</Label>
          <Input id="label-demo-default" className="w-48" placeholder="…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            peer-disabled
          </span>
          {/* `peer` + `peer-disabled:` dims the label when its paired input is
              disabled — the real Label contract; the input must precede it. */}
          <div className="flex flex-col gap-1.5">
            <Input
              id="label-demo-disabled"
              className="peer w-48"
              placeholder="…"
              disabled
            />
            <Label htmlFor="label-demo-disabled">Disabled field</Label>
          </div>
        </div>
      </div>
    </PrimitiveSection>
  );
}

function CardSection() {
  return (
    <PrimitiveSection
      title="Card"
      exportsLine="Card · CardHeader · CardTitle · CardDescription · CardContent · CardFooter"
    >
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Card title</CardTitle>
          <CardDescription>
            A short supporting description for the card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">
            Card content — the body region composes any primitives.
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button size="sm">Confirm</Button>
          <Button size="sm" variant="outline">
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </PrimitiveSection>
  );
}

function TabsSection() {
  return (
    <PrimitiveSection
      title="Tabs"
      exportsLine="Tabs · TabsList · TabsTrigger · TabsContent"
    >
      <Tabs defaultValue="email" className="max-w-md">
        <TabsList>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="phone">Phone</TabsTrigger>
          <TabsTrigger value="disabled" disabled>
            Disabled
          </TabsTrigger>
        </TabsList>
        <TabsContent value="email">
          <p className="text-sm text-muted-foreground">
            Active panel — only the selected tab&apos;s content is in the DOM.
          </p>
        </TabsContent>
        <TabsContent value="phone">
          <p className="text-sm text-muted-foreground">Phone sign-in panel.</p>
        </TabsContent>
      </Tabs>
    </PrimitiveSection>
  );
}

function OtpSection() {
  return (
    <PrimitiveSection
      title="Input OTP"
      exportsLine="InputOTP · InputOTPGroup · InputOTPSlot · InputOTPSeparator"
    >
      <div className="flex flex-wrap gap-8">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            filled (6, grouped + separator)
          </span>
          {/* Bare specimens carry an accessible name (no visible <Label>) so the
              underlying OTP input is not flagged unlabelled by the axe `label`
              rule (#351); real surfaces label via OtpField/FormField. */}
          <InputOTP
            maxLength={6}
            value="123456"
            readOnly
            onChange={() => {}}
            aria-label="One-time code sample (filled, read-only)"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            empty (4)
          </span>
          <InputOTP
            maxLength={4}
            value=""
            onChange={() => {}}
            aria-label="One-time code sample (empty)"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            disabled
          </span>
          <InputOTP
            maxLength={4}
            value="12"
            disabled
            onChange={() => {}}
            aria-label="One-time code sample (disabled)"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        </div>
      </div>
    </PrimitiveSection>
  );
}

/**
 * Field primitives need a real RHF context. Each demo mounts its own `<Form>`
 * (FormProvider) so the field renders its full FormItem (label + control +
 * inline message). The `error` demo seeds a real validation error on mount so
 * the destructive border + inline error message render exactly as on a live form.
 */
function FieldDemo({
  name,
  error,
  children,
}: {
  name: string;
  error?: string;
  children: (control: Control<FieldValues>) => ReactNode;
}) {
  const form = useForm<FieldValues>({
    defaultValues: { [name]: "" },
    mode: "onTouched",
  });
  // Seed the demo error once on mount (the error string is fixed per demo).
  useEffect(() => {
    if (error) form.setError(name, { type: "manual", message: error });
  }, [error, name, form]);
  return (
    <Form {...form}>
      <form className="w-72" onSubmit={(e) => e.preventDefault()}>
        {children(form.control)}
      </form>
    </Form>
  );
}

function FieldsSection() {
  return (
    <PrimitiveSection
      title="Fields"
      exportsLine="EmailField · PhoneField · IdentifierField · PasswordField · OtpField"
    >
      <p className="text-sm text-muted-foreground">
        Each semantic field is shown in its resting state and with a seeded
        validation error (the inline destructive message + invalid border).
      </p>

      <FieldGrid label="EmailField">
        <FieldDemo name="email">
          {(control) => (
            <FormField
              name="email"
              control={control}
              render={({ field }) => (
                <EmailField
                  field={field}
                  label="Email"
                  placeholder="you@example.com"
                />
              )}
            />
          )}
        </FieldDemo>
        <FieldDemo name="email" error="Enter a valid email address.">
          {(control) => (
            <FormField
              name="email"
              control={control}
              render={({ field }) => (
                <EmailField field={field} label="Email" placeholder="you@…" />
              )}
            />
          )}
        </FieldDemo>
      </FieldGrid>

      <FieldGrid label="PhoneField">
        <FieldDemo name="phone">
          {(control) => (
            <FormField
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneField
                  field={field}
                  label="Phone"
                  placeholder="+79991234567"
                />
              )}
            />
          )}
        </FieldDemo>
        <FieldDemo name="phone" error="Enter a valid phone number.">
          {(control) => (
            <FormField
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneField field={field} label="Phone" placeholder="+7…" />
              )}
            />
          )}
        </FieldDemo>
      </FieldGrid>

      <FieldGrid label="IdentifierField">
        <FieldDemo name="identifier">
          {(control) => (
            <FormField
              name="identifier"
              control={control}
              render={({ field }) => (
                <IdentifierField
                  field={field}
                  label="Email or phone"
                  placeholder="you@example.com"
                />
              )}
            />
          )}
        </FieldDemo>
        <FieldDemo name="identifier" error="Enter an email or phone.">
          {(control) => (
            <FormField
              name="identifier"
              control={control}
              render={({ field }) => (
                <IdentifierField
                  field={field}
                  label="Email or phone"
                  placeholder="you@…"
                />
              )}
            />
          )}
        </FieldDemo>
      </FieldGrid>

      <FieldGrid label="PasswordField (purpose=new, with policy hint)">
        <FieldDemo name="password">
          {(control) => (
            <FormField
              name="password"
              control={control}
              render={({ field }) => (
                <PasswordField
                  field={field}
                  purpose="new"
                  label="Password"
                  policyHint="At least 8 characters with a letter and a number."
                />
              )}
            />
          )}
        </FieldDemo>
        <FieldDemo name="password" error="Password is too weak.">
          {(control) => (
            <FormField
              name="password"
              control={control}
              render={({ field }) => (
                <PasswordField
                  field={field}
                  purpose="new"
                  label="Password"
                  policyHint="At least 8 characters with a letter and a number."
                />
              )}
            />
          )}
        </FieldDemo>
      </FieldGrid>

      <FieldGrid label="OtpField (variant=slotted, length=6)">
        <FieldDemo name="otp">
          {(control) => (
            <FormField
              name="otp"
              control={control}
              render={({ field }) => (
                <OtpField
                  field={field}
                  length={6}
                  variant="slotted"
                  charset="alphanumeric"
                  label="Verification code"
                />
              )}
            />
          )}
        </FieldDemo>
        <FieldDemo name="otp" error="That code is incorrect.">
          {(control) => (
            <FormField
              name="otp"
              control={control}
              render={({ field }) => (
                <OtpField
                  field={field}
                  length={6}
                  variant="slotted"
                  charset="alphanumeric"
                  label="Verification code"
                />
              )}
            />
          )}
        </FieldDemo>
      </FieldGrid>
    </PrimitiveSection>
  );
}

function FieldGrid({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <SubRow label={label}>
      <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
        {children}
      </div>
    </SubRow>
  );
}

/**
 * Standalone Form primitives demo — `FormDescription` and a `FormMessage` helper
 * are exercised here directly (the field primitives use FormMessage for errors;
 * this shows the resting helper/description tones).
 */
function FormPrimitivesSection() {
  const form = useForm<FieldValues>({
    defaultValues: { display: "" },
    mode: "onTouched",
  });
  return (
    <PrimitiveSection
      title="Form"
      exportsLine="Form · FormField · FormItem · FormLabel · FormControl · FormDescription · FormMessage"
    >
      <Form {...form}>
        <form className="w-72" onSubmit={(e) => e.preventDefault()}>
          <FormField
            name="display"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input placeholder="Dr. Doctorova" {...field} />
                </FormControl>
                <FormDescription>Shown on your public profile.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
      <SubRow label='FormError variant="banner" — operation-level refusal (#2027)'>
        <div className="flex w-72 flex-col gap-3">
          <FormError variant="banner">
            Не удалось войти. Проверьте адрес и пароль.
          </FormError>
          <FormError>Не удалось войти. Проверьте адрес и пароль.</FormError>
        </div>
      </SubRow>
      <SubRow label='tone="on-primary" — invariant primary surface'>
        <OnPrimaryFormToneDemo />
      </SubRow>
      <SubRow label="FormErrorSummary — long-form invalid submit">
        <form
          className="flex w-72 flex-col gap-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="summary-name" required>
              Name
            </Label>
            <Input id="summary-name" aria-invalid="true" />
          </div>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="summary-role" required>
              Role
            </Label>
            <NativeSelect id="summary-role" aria-invalid="true" defaultValue="">
              <option value="" disabled>
                Choose a role
              </option>
              {NATIVE_SELECT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit">Submit sample</Button>
          <div data-showcase-force="focus">
            <FormErrorSummary
              className={FORCED_FOCUS}
              title="Check the highlighted fields"
              errors={[
                { fieldId: "summary-name", message: "Enter your name" },
                { fieldId: "summary-role", message: "Choose a role" },
              ]}
            />
          </div>
          <FormErrorSummary title="Check the highlighted fields" errors={[]} />
          <span className="text-xs text-muted-foreground">
            Empty errors array: no summary is rendered.
          </span>
        </form>
      </SubRow>
    </PrimitiveSection>
  );
}

function OnPrimaryFormToneDemo() {
  const form = useForm<{ field: string }>({ defaultValues: { field: "" } });
  useEffect(() => {
    form.setError("field", { type: "manual", message: "Choose a role" });
  }, [form]);

  return (
    <div className="flex w-72 flex-col gap-3 bg-primary-surface p-4">
      <Form {...form}>
        <FormField
          control={form.control}
          name="field"
          render={() => (
            <FormItem>
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />
      </Form>
      <FormError tone="on-primary">Unable to save. Try again.</FormError>
    </div>
  );
}

/**
 * The success field demo (#529, source §07 `Success` cell) — a verified field: the
 * `FormControl` wires the label + ids, the `Input` carries the green `data-success`
 * border + `success-tint` fill, and the `FormMessage success` renders the `✓ Адрес
 * подтверждён` confirmation. A real RHF context so it mounts exactly as on a form.
 */
function SuccessFieldDemo() {
  const form = useForm<FieldValues>({
    defaultValues: { verified: "anna@nmic.ru" },
    mode: "onTouched",
  });
  return (
    <Form {...form}>
      <form className="w-full" onSubmit={(e) => e.preventDefault()}>
        <FormField
          name="verified"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input data-success="true" {...field} />
              </FormControl>
              <FormMessage success>Адрес подтверждён</FormMessage>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * The error field demo (#529, source §07 `Error` cell) — an invalid field: a
 * required-marked label (`Email *`), the `FormControl`-driven `aria-invalid`
 * destructive border + `destructive-tint` fill on the `Input`, and the `FormMessage`
 * error tone `⚠ Неверный формат e-mail` (canvas wording). The error tone already
 * ships (`FORM_ERROR_TONE`, #512) — this is section composition, no primitive change.
 */
function ErrorFieldDemo() {
  const form = useForm<FieldValues>({
    defaultValues: { invalid: "anna@clinic" },
    mode: "onTouched",
  });
  // Seed the error once on mount so the destructive border + inline message render
  // exactly as on a live validation failure.
  useEffect(() => {
    form.setError("invalid", {
      type: "manual",
      message: "Неверный формат e-mail",
    });
  }, [form]);
  return (
    <Form {...form}>
      <form className="w-full" onSubmit={(e) => e.preventDefault()}>
        <FormField
          name="invalid"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * Field states (#529, source §07 «Формы и валидация») — the four states staged
 * alongside each other in the canvas that were deferred from #512: a required-marked
 * label (destructive `*`), a filled input (`hairline` → ink `border` once it holds a
 * value), an error field (destructive border + `destructive-tint` fill + `⚠` message),
 * and a success field (green `success` border + `success-tint` fill + `✓`
 * confirmation). Rendered in BOTH themes — `success` / `border` / `success-tint` /
 * `destructive` are theme-flipping semantic tokens, so a single-theme render proves
 * only half the contract.
 */
function FieldStatesSection() {
  return (
    <PrimitiveSection
      title="Field states (source §07)"
      exportsLine="Label required · Input filled → ink border · FormMessage error / success"
    >
      <SubRow label="Required label · Filled input · Error · Success — light + dark">
        <ThemePair
          render={(theme) => (
            // `text-foreground` establishes the panel's theme-flipped ink baseline so
            // the raw <Label>s inside consume the forced `.light`/`.dark` foreground
            // token (a bare label would otherwise inherit the page-theme ink literal).
            <div className="flex w-full flex-col gap-6 text-foreground">
              <Cell label="required label + filled input (ink border)">
                <div className="flex w-full flex-col gap-2.5">
                  <Label htmlFor={`fs-req-${theme}`} required>
                    Email
                  </Label>
                  <Input
                    id={`fs-req-${theme}`}
                    className="w-full"
                    defaultValue="anna@nmic.ru"
                  />
                </div>
              </Cell>
              <Cell label="empty input (hairline border)">
                <Input
                  aria-label={`Empty sample (${theme})`}
                  className="w-full"
                  placeholder="you@example.com"
                />
              </Cell>
              <Cell label="error (invalid)">
                <ErrorFieldDemo />
              </Cell>
              <Cell label="success (verified)">
                <SuccessFieldDemo />
              </Cell>
            </div>
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

/**
 * The new-language primitives (#513, source §05–§08) each carry theme-flipping
 * SEMANTIC tokens, so a single-theme render proves only half the contract. Every
 * §513 section renders its states TWICE — a light panel and a dark panel side by
 * side — so both themes are visible on one page AND the backend-free CI axe scan
 * (#351), which lands in the default theme, still sees dark-mode contrast.
 *
 * Each panel FORCES its theme with an explicit `.light` / `.dark` class (both flip
 * the token CSS vars for their subtree exactly as the product apps do). Forcing
 * `.light` — not merely omitting the class — is what keeps the light panel light
 * even when the runtime page toggle (#515) has set `.dark` on the ancestor `<html>`:
 * custom properties inherit, so an unclassed panel would follow the toggle; the
 * `.light` reset (tokens.css) pins it. The `render(theme)` signature also lets
 * grouped controls (radios) carry a per-panel `name`, so the light and dark radio
 * groups stay independent.
 */
function ThemePair({
  render,
}: {
  render: (theme: "light" | "dark") => ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className={
            "flex flex-col items-start gap-4 border-2 border-border bg-background p-6 " +
            theme
          }
        >
          <span className="font-mono text-xs text-muted-foreground">
            {theme}
          </span>
          {render(theme)}
        </div>
      ))}
    </div>
  );
}

/** A labelled specimen cell (state / variant name above the real component). */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Interactive filter chip — a human can toggle it (aria-pressed flips). */
function FilterChipLive() {
  const [on, setOn] = useState(false);
  return (
    <FilterChip selected={on} onClick={() => setOn((v) => !v)}>
      Кардиология
    </FilterChip>
  );
}

function FilterChipSection() {
  return (
    <PrimitiveSection
      title="Filter chip"
      exportsLine="FilterChip · filterChipVariants — state (aria-pressed toggle)"
    >
      <SubRow label="Live sample (click to toggle selection)">
        <FilterChipLive />
      </SubRow>
      {/* AA carve-out note: the `disabled` copy is `muted-2` (neutral.400) — the
          faintest non-body tier, intentionally below body-text AA. It is only ever
          used on a DISABLED / decorative label (here, and in checkbox / radio /
          switch / button disabled states), never for active body text (#511). */}
      <p className="max-w-2xl text-sm text-muted-foreground">
        The disabled label uses{" "}
        <code className="font-mono text-xs">muted-2</code> (neutral.400) — the
        faintest tier, below body AA by design and reserved for disabled /
        decorative text only.
      </p>
      <SubRow label="States (source §06) — light + dark">
        <ThemePair
          render={() => (
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <Cell label="rest">
                <FilterChip>Кардиология</FilterChip>
              </Cell>
              <Cell label="hover">
                <div data-showcase-force="hover">
                  <FilterChip>Кардиология</FilterChip>
                </div>
              </Cell>
              <Cell label="selected">
                <FilterChip selected>Кардиология</FilterChip>
              </Cell>
              <Cell label="focus">
                <FilterChip className={FORCED_FOCUS}>Кардиология</FilterChip>
              </Cell>
              <Cell label="disabled">
                <FilterChip disabled>Кардиология</FilterChip>
              </Cell>
            </div>
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

function BadgeSection() {
  return (
    <PrimitiveSection
      title="Badge"
      exportsLine="Badge · badgeVariants — variant"
    >
      <ThemePair
        render={() => (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="live">В эфире</Badge>
            <Badge variant="label">Метка</Badge>
            <Badge variant="speaker">Спикер</Badge>
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

function AvatarSection() {
  return (
    <PrimitiveSection
      title="Avatar"
      exportsLine="Avatar · avatarVariants — variant"
    >
      <ThemePair
        render={() => (
          <div className="flex flex-wrap items-center gap-3">
            <Cell label="default">
              <Avatar>АС</Avatar>
            </Cell>
            <Cell label="tint">
              <Avatar variant="tint">МВ</Avatar>
            </Cell>
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

function CheckboxSection() {
  return (
    <PrimitiveSection
      title="Checkbox"
      exportsLine="Checkbox — state (real native checkbox); aria-invalid paints the reported-unmet border"
    >
      <SubRow label="Live sample (click / tab + space)">
        <Checkbox defaultChecked>Присылать напоминания об эфирах</Checkbox>
      </SubRow>
      <SubRow label="States (source §07) — light + dark">
        <ThemePair
          render={() => (
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <Cell label="off">
                <Checkbox aria-label="off" />
              </Cell>
              <Cell label="on">
                <Checkbox defaultChecked aria-label="on" />
              </Cell>
              <Cell label="disabled">
                <Checkbox disabled aria-label="disabled" />
              </Cell>
              <Cell label="disabled on">
                <Checkbox disabled defaultChecked aria-label="disabled on" />
              </Cell>
              <Cell label="invalid">
                <Checkbox aria-invalid aria-label="invalid" />
              </Cell>
              <Cell label="invalid on">
                <Checkbox aria-invalid defaultChecked aria-label="invalid on" />
              </Cell>
            </div>
          )}
        />
      </SubRow>
      <SubRow label="Wrapped label — the box stays square (#2027)">
        <div className="max-w-64">
          <Checkbox className="items-start">
            Согласие на передачу данных партнёрам платформы. Это условие
            бесплатного для врача обучения: без согласия часть материалов
            недоступна.
          </Checkbox>
        </div>
      </SubRow>
      <SubRow label='tone="on-primary" — enabled + disabled label'>
        <div className="flex flex-col items-start gap-3 bg-primary-surface p-4">
          <Checkbox tone="on-primary">I agree to data processing</Checkbox>
          <Checkbox tone="on-primary" disabled>
            Disabled consent
          </Checkbox>
        </div>
      </SubRow>
    </PrimitiveSection>
  );
}

function RadioSection() {
  return (
    <PrimitiveSection
      title="Radio"
      exportsLine="Radio — state (real native radio group)"
    >
      <SubRow label="States (source §07) — light + dark">
        <ThemePair
          render={(theme) => (
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <Cell label="off">
                <Radio name={`dir-${theme}`} value="off" aria-label="off" />
              </Cell>
              <Cell label="on">
                <Radio
                  name={`dir-${theme}`}
                  value="on"
                  defaultChecked
                  aria-label="on"
                />
              </Cell>
              <Cell label="disabled">
                <Radio
                  name={`dir-dis-${theme}`}
                  value="d"
                  disabled
                  aria-label="disabled"
                />
              </Cell>
            </div>
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

function SwitchSection() {
  return (
    <PrimitiveSection title="Switch" exportsLine="Switch — state (role=switch)">
      <SubRow label="Live sample (click / tab + space)">
        <Switch defaultChecked>Уведомления в Telegram</Switch>
      </SubRow>
      <SubRow label="States (source §07) — light + dark">
        <ThemePair
          render={() => (
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <Cell label="off">
                <Switch aria-label="off" />
              </Cell>
              <Cell label="on">
                <Switch defaultChecked aria-label="on" />
              </Cell>
              <Cell label="disabled">
                <Switch disabled aria-label="disabled" />
              </Cell>
            </div>
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

function AlertSection() {
  return (
    <PrimitiveSection
      title="Alert"
      exportsLine="Alert · alertVariants — variant"
    >
      {/* AA carve-out note: the success VARIANT reads on the `success-tint`
          surface (AA-safe for body copy), NOT on the raw `success` fill. The
          `success` fill + `success-foreground` pair (white on green.500) is
          3.68:1 — the large/bold ≥3:1 carve-out only (#511), never normal-weight
          body text. The alert body deliberately never sits on the fill. */}
      <p className="max-w-2xl text-sm text-muted-foreground">
        Body copy reads on the <code className="font-mono text-xs">*-tint</code>{" "}
        surface. The raw <code className="font-mono text-xs">success</code> fill
        + <code className="font-mono text-xs">success-foreground</code> pair
        (white on green.500, 3.68:1) is the large/bold ≥3:1 carve-out only — not
        for normal-weight body text.
      </p>
      <ThemePair
        render={() => (
          <div className="flex w-full flex-col gap-3">
            <Alert variant="info">
              <b>Инфо.</b> Эфир начнётся через 15 минут — мы пришлём
              напоминание.
            </Alert>
            <Alert variant="success">
              <b>Успех.</b> Вы записаны на эфир — добавили в календарь.
            </Alert>
            <Alert variant="warn">
              <b>Внимание.</b> Запись эфира будет доступна только 30 дней.
            </Alert>
            <Alert variant="danger">
              <b>Ошибка.</b> Не удалось подключиться к эфиру — обновите
              страницу.
            </Alert>
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

/**
 * The correct loading pattern for the Skeleton primitive. Each `Skeleton` is
 * decorative and always `aria-hidden` (it carries no content a screen reader
 * should announce), so on its own a skeleton block is INVISIBLE to assistive
 * tech — a non-sighted user would get silence while the region loads. The
 * accessible-name + busy signal must therefore live on the WRAPPER: an
 * `aria-busy="true"` region with `role="status"` and an sr-only label, so the
 * loading state is announced once and the hidden skeletons are pure visual
 * placeholder. When the real content arrives the app flips `aria-busy` to
 * `false` and swaps the skeletons for the content.
 */
function LoadingCard() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex w-full items-center gap-4 border-2 border-border bg-card p-4"
    >
      {/* sr-only status text — the only thing assistive tech announces here; the
          skeletons themselves stay aria-hidden. */}
      <span className="sr-only">Loading profile…</span>
      <Skeleton className="size-14" />
      <div className="flex flex-1 flex-col gap-2.5">
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

function SkeletonSection() {
  return (
    <PrimitiveSection
      title="Skeleton"
      exportsLine="Skeleton — composable loading placeholder"
    >
      <SubRow label="Composition (each block is decorative, aria-hidden)">
        <ThemePair
          render={() => (
            <div className="flex w-full items-center gap-4">
              <Skeleton className="size-14" />
              <div className="flex flex-1 flex-col gap-2.5">
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          )}
        />
      </SubRow>

      <SubRow label='Loading pattern — aria-busy="true" region wraps the hidden skeletons'>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A <code className="font-mono text-xs">Skeleton</code> is always{" "}
          <code className="font-mono text-xs">aria-hidden</code>, so it is
          invisible to assistive tech. Model the loading state on the WRAPPER:
          an{" "}
          <code className="font-mono text-xs">aria-busy=&quot;true&quot;</code>{" "}
          <code className="font-mono text-xs">role=&quot;status&quot;</code>{" "}
          region with an sr-only label announces &ldquo;Loading…&rdquo; once;
          the skeletons stay pure visual placeholder. Flip{" "}
          <code className="font-mono text-xs">aria-busy</code> to{" "}
          <code className="font-mono text-xs">false</code> and swap in the real
          content when it arrives.
        </p>
        <ThemePair render={() => <LoadingCard />} />
      </SubRow>
    </PrimitiveSection>
  );
}

function ContactChipSection() {
  return (
    <PrimitiveSection
      title="Contact-chip"
      exportsLine="ContactChip — one contact channel as a chip (028 EARS-14)"
    >
      <SubRow label="Channels — the host supplies the label, the mark and the order">
        <ThemePair
          render={() => (
            <div className="flex flex-wrap items-center gap-3">
              <ContactChip
                href="mailto:support@doctor.school"
                label="support@doctor.school"
                icon={<span className="font-mono text-xs">@</span>}
              />
              <ContactChip href="tel:+78001234567" label="8 800 123-45-67" />
              <ContactChip
                href="https://t.me/doctorschool"
                label="Telegram"
                icon={<span className="font-mono text-xs">TG</span>}
              />
            </div>
          )}
        />
      </SubRow>

      <SubRow label="Destination decides the opener — the one thing the chip owns">
        <p className="max-w-2xl text-sm text-muted-foreground">
          An <code className="font-mono text-xs">https:</code> destination is
          off-platform, so the chip opens it in a new tab with the opener
          severed (
          <code className="font-mono text-xs">
            rel=&quot;noopener noreferrer&quot;
          </code>
          ). A <code className="font-mono text-xs">mailto:</code> or{" "}
          <code className="font-mono text-xs">tel:</code> hands off to the
          operating system and stays in place — a{" "}
          <code className="font-mono text-xs">target=&quot;_blank&quot;</code>{" "}
          there would leave the reader on a blank tab. The channel mark is
          decorative (<code className="font-mono text-xs">aria-hidden</code>):
          the label already names the channel.
        </p>
      </SubRow>
    </PrimitiveSection>
  );
}

function DayBandSection() {
  return (
    <PrimitiveSection
      title="Day-band"
      exportsLine="DayBand — full-bleed section plate"
    >
      <ThemePair
        render={() => (
          <div className="w-full">
            <DayBand>Сегодня — 16 июля</DayBand>
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

function ContainerSection() {
  return (
    <PrimitiveSection
      title="Container"
      exportsLine="Container · containerVariants — §09 content column (content | calendar)"
    >
      <p className="text-sm text-muted-foreground">
        The §09 layout container centres the content column, caps it (
        <code className="font-mono text-xs">content</code> 1104px /{" "}
        <code className="font-mono text-xs">calendar</code> 1240px content) and
        applies the responsive gutter. Below the{" "}
        <code className="font-mono text-xs">layout</code> breakpoint (≤900px) it
        goes edge-to-edge on a fixed 16px gutter — resize the window, or open
        the{" "}
        <span className="font-medium text-foreground">Layout &amp; rhythm</span>{" "}
        section, to watch the cap engage. The dashed rule marks the viewport
        edge.
      </p>
      {(["content", "calendar"] as const).map((variant) => (
        <SubRow key={variant} label={`variant="${variant}"`}>
          <div className="w-full border-x border-dashed border-muted-foreground/40">
            <Container variant={variant} className="bg-section py-4">
              <div className="border-2 border-border bg-card p-inset text-sm text-foreground">
                Centred {variant} column · gutter + max-width from §09 tokens
              </div>
            </Container>
          </div>
        </SubRow>
      ))}
    </PrimitiveSection>
  );
}

const opts = (rows: ReadonlyArray<readonly [string, string]>) =>
  rows.map(([id, label]) => ({ id, label }));

/** The doctor's facet values — the same strings `events-facets.dc.html` draws. */
const EVENTS_FILTER_DOCTOR_OPTIONS: EventsFilterOptions = {
  format: opts([
    ["online", "Онлайн"],
    ["offline", "Офлайн"],
    ["hybrid", "Гибрид"],
  ]),
  kind: opts([
    ["webinar", "Вебинар"],
    ["efir", "Эфир"],
    ["congress", "Конгресс"],
    ["club", "Встреча клуба"],
    ["master", "Мастер-класс"],
    ["case", "Клинический разбор с пациентом"],
  ]),
  specialty: opts([
    ["endo", "Эндокринология"],
    ["rad", "Лучевая диагностика"],
    ["rehab", "Реабилитация"],
    ["rheum", "Ревматология"],
    ["sport", "Спортивная медицина"],
    ["ortho", "Травматология и ортопедия"],
  ]),
  city: opts(
    [
      "Москва",
      "Казань",
      "Новосибирск",
      "Барнаул",
      "Владивосток",
      "Волгоград",
      "Воронеж",
      "Екатеринбург",
      "Ижевск",
      "Иркутск",
      "Кемерово",
      "Краснодар",
      "Красноярск",
      "Махачкала",
      "Набережные Челны",
      "Нижний Новгород",
      "Омск",
      "Пермь",
      "Ростов-на-Дону",
      "Самара",
      "Санкт-Петербург",
      "Саратов",
      "Севастополь",
      "Ставрополь",
      "Тольятти",
      "Томск",
      "Тюмень",
      "Ульяновск",
      "Уфа",
      "Хабаровск",
      "Челябинск",
      "Ярославль",
    ].map((label, i) => [`c${i}`, label] as const),
  ),
  direction: opts([
    ["orthobio", "Ортобиология"],
    ["arthro", "Артроскопия"],
    ["sportmed", "Спортивная медицина"],
    ["rehab", "Реабилитация"],
  ]),
};

/** The Academy's facet values — projects, experts and topics of the canvas. */
const EVENTS_FILTER_ACADEMY_OPTIONS: EventsFilterOptions = {
  project: opts([
    ["as", "Академия смыслов"],
    ["sp", "Школа продюсеров"],
    ["p1", "Школа ортобиологии"],
    ["p2", "Школа артроскопии"],
  ]),
  expert: opts([
    ["belov", "Артём Белов"],
    ["vorontsova", "Елена Воронцова"],
    ["gromova", "Ирина Громова"],
  ]),
  topic: opts([
    ["partner", "Партнёрства"],
    ["program", "Программа школ"],
    ["production", "Продакшн эфиров"],
    ["metrics", "Метрики и отчётность"],
    ["regul", "Регуляторика"],
  ]),
};

const EVENTS_FILTER_SHARED_LABELS = {
  panel: "Фильтры",
  title: "Фильтры",
  appliedCount: (n: number) => `Применено: ${n}`,
  reset: "Сбросить",
  removeFacet: "Убрать",
  combobox: {
    emptyLabel: "Ничего не найдено",
    searchLabel: "Найти",
    countLabel: (shown: number, total: number) =>
      `Найдено ${shown} из ${total}`,
    loadMoreLabel: "Показать ещё",
    loadingMoreLabel: "Загружаем…",
    loadMoreErrorLabel: "Повторить",
  },
};

const EVENTS_FILTER_LABELS: Record<EventsFilterHost, EventsFilterLabels> = {
  doctor: {
    ...EVENTS_FILTER_SHARED_LABELS,
    query: { label: "Поиск по названию", placeholder: "Например, PRP" },
    specialty: {
      label: "Специальность",
      mine: "Моя и смежные",
      all: "Все специальности",
      placeholder: "Выбрать специальность",
      addPlaceholder: "Добавить специальность",
      searchPlaceholder: "Например, кардиология",
    },
    format: "Формат",
    kind: "Вид события",
    city: {
      label: "Город",
      hint: "Только для офлайн-событий",
      placeholder: "Любой город",
      addPlaceholder: "Добавить город",
      searchPlaceholder: "Начните вводить город",
    },
    direction: {
      label: "Направление",
      placeholder: "Любое направление",
      addPlaceholder: "Добавить направление",
      searchPlaceholder: "Например, артроскопия",
    },
    nmoOnly: "Только с НМО",
  },
  academy: {
    ...EVENTS_FILTER_SHARED_LABELS,
    project: {
      label: "Проект",
      placeholder: "Все проекты",
      addPlaceholder: "Добавить проект",
      searchPlaceholder: "Например, школа продюсеров",
    },
    expert: {
      label: "Эксперт",
      placeholder: "Все эксперты",
      addPlaceholder: "Добавить эксперта",
      searchPlaceholder: "Фамилия или имя",
    },
    topic: {
      label: "Тема",
      placeholder: "Все темы",
      addPlaceholder: "Добавить тему",
      searchPlaceholder: "Например, метрики",
    },
  },
};

const EVENTS_FILTER_PAGE = 20;

function EventsFilterDemo({
  host,
  initial,
  showHeader,
}: {
  host: EventsFilterHost;
  initial?: Partial<AppliedFacets>;
  showHeader?: boolean;
}) {
  const [applied, setApplied] = useState<AppliedFacets>({
    ...defaultAppliedFacets(),
    ...initial,
  });
  // City paging as the canvas draws it: 20 per page, «Показать ещё» for the
  // next page, the search narrowing the pool. A real host pages its server
  // read the same way through `paging.city`.
  const [cityQuery, setCityQuery] = useState("");
  const [cityPages, setCityPages] = useState(1);
  const base =
    host === "doctor"
      ? EVENTS_FILTER_DOCTOR_OPTIONS
      : EVENTS_FILTER_ACADEMY_OPTIONS;
  const q = cityQuery.trim().toLowerCase();
  const cityPool = (base.city ?? []).filter(
    (o) =>
      !applied.city.includes(o.id) && (!q || o.label.toLowerCase().includes(q)),
  );
  const options: EventsFilterOptions =
    host === "doctor"
      ? {
          ...base,
          city: [
            ...(base.city ?? []).filter((o) => applied.city.includes(o.id)),
            ...cityPool.slice(0, EVENTS_FILTER_PAGE * cityPages),
          ],
        }
      : base;

  return (
    <div className="w-full max-w-sm">
      <EventsFilter
        host={host}
        applied={applied}
        options={options}
        labels={EVENTS_FILTER_LABELS[host]}
        onChange={setApplied}
        onReset={() => setApplied(defaultAppliedFacets())}
        showHeader={showHeader}
        paging={{
          city: {
            onSearchChange: (value) => {
              setCityQuery(value);
              setCityPages(1);
            },
            hasMore: cityPool.length > EVENTS_FILTER_PAGE * cityPages,
            onLoadMore: () => setCityPages((n) => n + 1),
          },
        }}
      />
    </div>
  );
}

function EventsFilterSection() {
  return (
    <PrimitiveSection
      title="Events-filter"
      exportsLine="EventsFilter — the shared events facet panel; the host supplies its facet set (doctor · Академия) · header «Применено: N» + «Сбросить» · removable chips"
    >
      <p className="text-sm text-muted-foreground">
        019 EARS-7 / EARS-13 per «Amendment — 2026-10-05» (source{" "}
        <code className="font-mono text-xs">events-facets.dc.html</code>): the
        ONE shared facet panel of both storefronts. The{" "}
        <code className="font-mono text-xs">host</code> prop picks the facet set
        of the 019 <code className="font-mono text-xs">filterSet</code> row —
        the doctor gets поиск по названию, специальность («Моя и смежные» / «Все
        специальности» + поиск конкретных), формат, вид события, город для
        офлайн-событий, направление и «Только с НМО»; the Академия gets проект,
        эксперт и тема. Every picked combobox value stays visible as a removable
        chip under its facet; once anything is applied the header states
        «Применено: N» and offers «Сбросить».
      </p>
      <p className="text-sm text-muted-foreground">
        The panel declares no width or chrome of its own — the desktop column or
        the mobile sheet places it. The sheet hosts the same body with{" "}
        <code className="font-mono text-xs">showHeader=false</code> (the sheet
        carries its own title). A facet whose labels or options the host omits
        is not rendered.
      </p>
      <SubRow label='host="doctor" — nothing applied'>
        <ThemePair render={() => <EventsFilterDemo host="doctor" />} />
      </SubRow>
      <SubRow label='host="doctor" — several applied: «Применено: N», «Сбросить», removable chips, «Только с НМО» on'>
        <ThemePair
          render={() => (
            <EventsFilterDemo
              host="doctor"
              initial={{
                query: "PRP",
                specialtyScope: [
                  { id: "sport", label: "Спортивная медицина" },
                  { id: "rheum", label: "Ревматология" },
                ],
                format: ["offline", "hybrid"],
                kind: ["club"],
                city: ["c1"],
                direction: ["arthro"],
                nmoOnly: true,
              }}
            />
          )}
        />
      </SubRow>
      <SubRow label='host="academy" — nothing applied'>
        <ThemePair render={() => <EventsFilterDemo host="academy" />} />
      </SubRow>
      <SubRow label='host="academy" — project, expert and topic picked'>
        <ThemePair
          render={() => (
            <EventsFilterDemo
              host="academy"
              initial={{
                project: ["as"],
                expert: ["belov"],
                topic: ["metrics", "regul"],
              }}
            />
          )}
        />
      </SubRow>
      <SubRow label="showHeader={false} — the mobile sheet body (doctor, applied)">
        <ThemePair
          render={() => (
            <EventsFilterDemo
              host="doctor"
              showHeader={false}
              initial={{
                specialtyScope: "all",
                kind: ["webinar"],
                nmoOnly: true,
              }}
            />
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

function WebinarCardSection() {
  return (
    <PrimitiveSection
      title="Webinar-card"
      exportsLine="WebinarCard — listing unit (time plate · chips · speakers), stretched title link + optional room CTA"
    >
      <p className="text-sm text-muted-foreground">
        The §09 listing unit (source{" "}
        <code className="font-mono text-xs">unit-event-card.dc.html</code>): a
        tinted 196px time plate (56px display time, explicit МСК label) and the
        content column (school kicker, title, specialty chips, speakers). The
        card root is a container and the title is a stretched link, so the whole
        card opens its event page while a second action can sit alongside
        without nesting anchors. Desktop → the bordered, raised grid; ≤900px →
        flat full-bleed with a bottom divider. Resize to watch the split. The{" "}
        <span className="font-medium text-foreground">live</span> variant
        surfaces the «В эфире» signal; the{" "}
        <span className="font-medium text-foreground">live + room-CTA</span>{" "}
        variant (006 EARS-6, «мои события») adds the sibling «Войти в эфир»
        room-entry button that routes to{" "}
        <code className="font-mono text-xs">/webinars/:slug/room</code>.
      </p>
      <p className="text-sm text-muted-foreground">
        019 EARS-2 widens the same unit for the doctor feed exactly as the
        approved canvas draws it: the format/kind reads from the time-plate{" "}
        <span className="font-medium text-foreground">kicker</span> («Вебинар»,
        «Разбор», «Doctor Club», «Подкаст», «Конгресс»), and the one chip row
        carries the venue with the offline city, НМО, the Pul cost («бесплатно
        для врача» at zero, never roubles), the sign-up count — present in every
        card state — and the seats. Zero seats re-words that chip to «мест не
        осталось». A congress date span rides the time-plate sub-label.
      </p>
      {(
        [
          { key: "scheduled", live: false, cta: false },
          { key: "live", live: true, cta: false },
          { key: "live + room-CTA", live: true, cta: true },
        ] as const
      ).map((variant) => (
        <SubRow
          key={variant.key}
          label={
            variant.cta
              ? 'live + ctaHref/ctaLabel="Войти в эфир"'
              : `variant="${variant.key}"`
          }
        >
          <ThemePair
            render={() => (
              <div className="w-full">
                <WebinarCard
                  href="#"
                  time="19:00"
                  tzLabel="МСК"
                  dateLabel="16 июля · ср"
                  school="Школа травматологии и ортопедии"
                  title="Пластика ахиллова сухожилия: разбор клинических случаев"
                  specialties={["Травматология", "Ортопедия"]}
                  speakers={[
                    {
                      name: "Анна Соколова",
                      org: "Травматолог-ортопед, к.м.н.",
                    },
                    { name: "Михаил Верещагин", org: "Хирург, профессор" },
                  ]}
                  live={variant.live}
                  liveLabel="В эфире"
                  ctaHref={variant.cta ? "#room" : undefined}
                  ctaLabel={variant.cta ? "Войти в эфир" : undefined}
                />
              </div>
            )}
          />
        </SubRow>
      ))}

      {DOCTOR_FEED_CARDS.map((variant) => (
        <SubRow key={variant.label} label={variant.label}>
          <ThemePair
            render={() => (
              <div className="w-full">
                <WebinarCard
                  href="#"
                  time="19:00"
                  tzLabel="МСК"
                  dateLabel={
                    "dateLabel" in variant ? variant.dateLabel : "16 июля · ср"
                  }
                  school="Школа травматологии и ортопедии"
                  title={variant.title}
                  speakers={[{ name: "Анна Соколова", org: "К.м.н." }]}
                  nmoLabel="НМО · 2 ЗЕТ"
                  freeLabel="бесплатно для врача"
                  pulCostLabel="120 Pul"
                  signUpLabel="коллег записались"
                  seatsLeftLabel="мест осталось"
                  soldOutLabel="мест не осталось"
                  registeredLabel="Вы записаны"
                  {...variant.props}
                />
              </div>
            )}
          />
        </SubRow>
      ))}
    </PrimitiveSection>
  );
}

/**
 * 019 EARS-2 — the widened doctor-feed states of the SAME shared unit, staged
 * exactly as the approved canvas (`design-source/doctor-events.dc.html`) draws
 * them: the format is the time-plate KICKER («Вебинар», «Разбор», «Doctor
 * Club», «Подкаст», «Конгресс») and everything else — venue with the offline
 * city, НМО, cost in Pul, the sign-up count, the seat state — is a text chip in
 * the one chip row. No coloured format badge, no separate facts strip. No
 * screen-local card exists anywhere; the doctor feed supplies data and copy,
 * never JSX.
 */
const DOCTOR_FEED_CARDS = [
  {
    label: "kicker «Вебинар» · онлайн · НМО · 120 Pul",
    title: "Пластика ахиллова сухожилия: разбор клинических случаев",
    props: {
      formatLabel: "Вебинар",
      venueLabel: "Онлайн",
      pulCost: 120,
      signUpCount: 128,
    },
  },
  {
    label: "kicker «Разбор» · бесплатно для врача",
    title: "Разбор клинического случая с экспертом",
    props: {
      formatLabel: "Разбор",
      venueLabel: "Онлайн",
      pulCost: 0,
      signUpCount: 42,
    },
  },
  {
    label: "kicker «Doctor Club» · офлайн · city + seatsLeft",
    title: "Doctor Club Казань — встреча коллег по направлению",
    props: {
      formatLabel: "Doctor Club",
      venueLabel: "Офлайн",
      pulCost: 0,
      signUpCount: 18,
      city: "Казань",
      seatsLeft: 12,
    },
  },
  {
    label: "kicker «Doctor Club» · seatsLeft=0 → «мест не осталось»",
    title: "Doctor Club: вечер травматологии",
    props: {
      formatLabel: "Doctor Club",
      venueLabel: "Офлайн",
      pulCost: 0,
      signUpCount: 60,
      city: "Новосибирск",
      seatsLeft: 0,
    },
  },
  {
    label: "kicker «Конгресс» · гибрид, дата-спан на плите, registered",
    title: "Конгресс «Ортобиология-2026»",
    dateLabel: "14–15 ноября",
    props: {
      formatLabel: "Конгресс",
      venueLabel: "Гибрид",
      pulCost: 450,
      pulCostLabel: "450 Pul",
      signUpCount: 314,
      city: "Москва",
      seatsLeft: 40,
      registered: true,
    },
  },
  {
    label: "kicker «Подкаст» · live",
    title: "Подкаст «Разбор»: эфир о боли в плече",
    props: {
      formatLabel: "Подкаст",
      venueLabel: "Онлайн",
      pulCost: 0,
      signUpCount: 9,
      live: true,
      liveLabel: "В эфире",
    },
  },
] as const;

function WebinarPageContentSection() {
  return (
    <PrimitiveSection
      title="Webinar-page-content"
      exportsLine="WebinarPageContent — event-page body (description · program PDF · sponsor plate · speakers)"
    >
      <p className="text-sm text-muted-foreground">
        The event-page content set (source{" "}
        <code className="font-mono text-xs">event-page.dc.html</code>, 004
        EARS-2): the complete decision set from the{" "}
        <code className="font-mono text-xs">PublicEventPage</code> projection —
        the «О чём эфир» description, the downloadable program PDF, the sponsor
        plate (backing partners), and the «Спикеры» aside cards. Desktop → the
        canvas <span className="font-medium text-foreground">1fr / 380px</span>{" "}
        two-column split; ≤900px → stacked. All copy is injected (EARS-13). The
        program affordance is omitted when the event carries no PDF.
      </p>
      <ThemePair
        render={() => (
          <div className="w-full">
            <WebinarPageContent
              description="Разбираем три реальных случая пластики ахиллова сухожилия — от выбора техники до реабилитационного протокола. Без лекционной воды: снимки, интраоперационные видео, осложнения и честный разбор ошибок."
              speakers={[
                {
                  name: "Анна Соколова",
                  credentials:
                    "Травматолог-ортопед, к.м.н. · НМИЦ им. Пирогова",
                },
                {
                  name: "Михаил Верещагин",
                  credentials: "Хирург, профессор · Сеченовский университет",
                },
              ]}
              partners={[{ label: "Acme Pharma" }]}
              programPdfUrl="#"
              aboutLabel="О чём эфир"
              programLabel="Программа"
              programDownloadLabel="Скачать программу (PDF)"
              speakersLabel="Спикеры"
              sponsorEyebrow="При поддержке"
              sponsorNote="Спонсор оплачивает эфир и не влияет на программу. Содержание определяют спикеры и школа."
            />
          </div>
        )}
      />
    </PrimitiveSection>
  );
}

function WebinarStatusCardSection() {
  const states = [
    {
      key: "upcoming",
      timeLabel: "Начало",
      time: "19:00",
      timeSub: "16 июля · МСК · 90 мин",
      head: "Регистрация открыта",
      sub: "Бесплатно. Пришлём ссылку на почту и напомним за час до старта.",
      cta: "Участвовать",
      live: false,
    },
    {
      key: "live",
      timeLabel: "Сейчас",
      time: "19:00",
      timeSub: "16 июля · МСК · идёт",
      head: "Эфир уже идёт",
      sub: "Бесплатно. Нужна регистрация врача — почта и специальность, две минуты.",
      cta: "Участвовать",
      live: true,
    },
    {
      key: "ended",
      timeLabel: "Прошёл",
      time: "19:00",
      timeSub: "16 июля · МСК",
      head: "Эфир завершён",
      sub: "Этот эфир уже прошёл. Регистрация закрыта.",
      cta: null,
      live: false,
    },
  ] as const;
  return (
    <PrimitiveSection
      title="Webinar-status-card"
      exportsLine="WebinarStatusCard — event-page lifecycle status card (time plate · head/sub · CTA slot)"
    >
      <p className="text-sm text-muted-foreground">
        The event-page status card (source{" "}
        <code className="font-mono text-xs">event-page.dc.html</code>, 004
        EARS-4): the lifecycle affordance the page swaps per{" "}
        <code className="font-mono text-xs">EventLifecycleState</code> — the
        webinar-card time plate + a head/sub signal + a single primary-CTA slot.
        The <span className="font-medium text-foreground">live</span> render
        surfaces the «В эфире» signal; the{" "}
        <span className="font-medium text-foreground">ended</span> render passes
        no CTA (no dead link). Desktop → the 196px time-plate grid; ≤900px →
        flat full-bleed.
      </p>
      {states.map((s) => (
        <SubRow key={s.key} label={`status="${s.key}"`}>
          <ThemePair
            render={() => (
              <div className="w-full">
                <WebinarStatusCard
                  live={s.live}
                  liveLabel="В эфире"
                  timeLabel={s.timeLabel}
                  time={s.time}
                  timeSub={s.timeSub}
                  head={s.head}
                  sub={s.sub}
                >
                  {s.cta ? (
                    <Button asChild size="lg">
                      <a href="#">{s.cta}</a>
                    </Button>
                  ) : null}
                </WebinarStatusCard>
              </div>
            )}
          />
        </SubRow>
      ))}
    </PrimitiveSection>
  );
}

function WebinarRecordingPlaqueSection() {
  const states = [
    {
      key: "dated",
      time: "до 18 июля",
      body: "Монтируем запись — опубликуем на этой странице до 18 июля.",
    },
    {
      key: "undated",
      time: null,
      body: "Монтируем запись — она появится на этой странице, как только будет готова.",
    },
  ] as const;
  return (
    <PrimitiveSection
      title="Webinar-recording-plaque"
      exportsLine="WebinarRecordingPlaque — «запись готовится» plaque (time plate · head/body, no CTA)"
    >
      <p className="text-sm text-muted-foreground">
        The post-live «запись готовится» plaque (source{" "}
        <code className="font-mono text-xs">event-page-recording.dc.html</code>,
        014 EARS-7): what occupies the player position while nothing is
        published yet. The{" "}
        <span className="font-medium text-foreground">dated</span> render
        carries the operator&apos;s committed readiness day; the{" "}
        <span className="font-medium text-foreground">undated</span> render
        omits the time-plate value entirely (hide-until-content) and lets the
        body carry the honest date-free line — the plaque never invents an
        estimate. It has NO CTA slot by design: readiness notifications are a
        declared 014 non-goal, so a «Напомнить на почту» button would be a dead
        affordance.
      </p>
      {states.map((s) => (
        <SubRow key={s.key} label={`expectedBy="${s.key}"`}>
          <ThemePair
            render={() => (
              <div className="w-full">
                <WebinarRecordingPlaque
                  timeLabel="Запись"
                  time={s.time}
                  title="Запись готовится"
                  body={s.body}
                />
              </div>
            )}
          />
        </SubRow>
      ))}
    </PrimitiveSection>
  );
}

function RecordingSpoilerSection() {
  return (
    <PrimitiveSection
      title="Recording-spoiler"
      exportsLine="RecordingSpoiler — «Смотреть оригинал трансляции» disclosure (native details/summary · body mounted only while open)"
    >
      <p className="text-sm text-muted-foreground">
        The secondary-cut disclosure that sits under the post-live player when
        an эфир published BOTH cuts (source{" "}
        <code className="font-mono text-xs">event-page-recording.dc.html</code>,
        014 EARS-8). It is a native{" "}
        <code className="font-mono text-xs">
          &lt;details&gt;/&lt;summary&gt;
        </code>{" "}
        so keyboard operation and the expanded/collapsed state exposed to
        assistive tech come from the platform. The body is mounted ONLY while
        open: the child is a provider iframe, and a collapsed{" "}
        <code className="font-mono text-xs">&lt;details&gt;</code> would keep it
        in the DOM fetching a recording nobody asked to watch. With a single
        published cut the host renders nothing here — there is no empty state.
      </p>
      <SubRow label="hint / no hint">
        <ThemePair
          render={() => (
            <div className="flex w-full flex-col gap-4">
              <RecordingSpoiler
                summaryLabel="Смотреть оригинал трансляции"
                hint="без монтажа, с паузами и вопросами между блоками"
              >
                <div className="flex aspect-video items-center justify-center bg-header text-sm text-neutral-300">
                  Оригинал трансляции
                </div>
              </RecordingSpoiler>
              <RecordingSpoiler summaryLabel="Смотреть оригинал трансляции">
                <div className="flex aspect-video items-center justify-center bg-header text-sm text-neutral-300">
                  Оригинал трансляции
                </div>
              </RecordingSpoiler>
            </div>
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

function WebinarRoomSection() {
  // A static demo of the Twitch-model composition shell (#1123): the player is now
  // REGION CONTENT (pinned inset-0 inside the dark letterbox the layout owns, not
  // its own aspect box), a one-line context strip sits under it, the chat column
  // has a collapsible header + a borderless ledger, and the mobile info tab gets
  // the full context block. No real embed iframe / Centrifugo here — sensible
  // showcase-internal RU demo strings.
  const playerFrame = (
    <>
      <Badge variant="live" className="absolute left-4 top-4 z-10">
        В эфире
      </Badge>
      <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300">
        Плеер эфира
      </div>
    </>
  );
  const contextStrip = (
    <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
      <span className="text-2xs font-extrabold uppercase tracking-micro text-primary-action whitespace-nowrap">
        Школа травматологии и ортопедии · Эфир № 042
      </span>
      <span className="text-sm font-extrabold tracking-tight text-foreground">
        Пластика ахиллова сухожилия: разбор случаев
      </span>
      <span className="text-caption text-muted-foreground">
        Анна Соколова · Михаил Верещагин
      </span>
    </div>
  );
  const context = (
    <div>
      <p className="text-caption font-extrabold uppercase tracking-micro text-primary-action">
        Школа травматологии и ортопедии
      </p>
      <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground">
        Пластика ахиллова сухожилия: разбор случаев
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Анна Соколова · Михаил Верещагин
      </p>
    </div>
  );
  const chat = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none border-b-2 border-hairline bg-tint px-4 py-2.5 text-caption leading-relaxed text-tint-foreground">
        📌 Модератор: вопросы можно задавать прямо в чате.
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3">
          <div className="text-sm leading-relaxed text-foreground break-words">
            <span className="font-bold text-foreground">Участник B2</span> Уже в
            эфире, коллеги!
          </div>
          <div className="text-sm leading-relaxed text-foreground break-words">
            <span className="font-bold text-foreground">Участник C7</span>{" "}
            Отличный разбор доступов, спасибо!
          </div>
          <div className="text-sm leading-relaxed text-foreground break-words">
            <span className="font-bold text-primary-action">Вы</span> Ждём блок
            вопросов по реабилитации.
          </div>
        </div>
      </div>
      <div className="flex flex-none gap-3 border-t-2 border-border p-4">
        <input
          placeholder="Написать в чат…"
          aria-label="Написать в чат"
          disabled
          className="min-w-0 flex-1 border-2 border-hairline bg-card px-4 py-3 text-sm text-foreground"
        />
        <button
          type="button"
          disabled
          className="border-2 border-border bg-primary-action px-4 py-3 text-sm font-extrabold text-primary-foreground shadow-sm"
        >
          Отправить
        </button>
      </div>
    </div>
  );
  return (
    <PrimitiveSection
      title="Webinar-room"
      exportsLine="WebinarRoomLayout — the viewport-bounded webinar room shell (maximized player + collapsible chat; mobile Чат / О эфире tabs)"
    >
      <p className="text-sm text-muted-foreground">
        The webinar room layout (source{" "}
        <code className="font-mono text-xs">unit-room-frame.dc.html</code> +{" "}
        <code className="font-mono text-xs">unit-chat-column.dc.html</code>, 006
        EARS-2/EARS-11): a viewport-bounded flex shell — the player region is
        maximized (no custom chrome), a one-line context strip sits under it,
        and the chat is a 340px aside that collapses to a 44px rail; mobile a
        full-bleed player + Чат / О эфире tabs. The chat ledger is
        Twitch-minimal (borderless rows, stick-to-bottom); behaviour is EARS-3.
      </p>
      <SubRow label="composition">
        <ThemePair
          render={() => (
            // The shell is viewport-bounded (fills its parent's height) — the
            // showcase gives it a fixed demo height so it renders visibly.
            <div className="flex w-full" style={{ height: "34rem" }}>
              <WebinarRoomLayout
                chatTabLabel="Чат"
                infoTabLabel="О эфире"
                chatHeading="Чат эфира"
                chatCount={214}
                collapseLabel="Свернуть чат"
                expandLabel="Развернуть чат"
                player={playerFrame}
                contextStrip={contextStrip}
                context={context}
                chat={chat}
              />
            </div>
          )}
        />
      </SubRow>
    </PrimitiveSection>
  );
}

/**
 * The modal pair (#1339). A modal is the one primitive whose specimen cannot be
 * a static cell: everything worth showing — the scrim, the focus trap, where
 * initial focus lands, whether an outside press dismisses — only exists while it
 * is OPEN. So the specimen is the real trigger, and the reader opens it.
 *
 * `container` is what keeps the theme pair honest. Both primitives portal to
 * `document.body` by default (an app modal must escape clipping ancestors), and a
 * body-level portal would render the DARK specimen against the page's light
 * chrome. Pointing the portal at the pane node puts the modal back inside the
 * `.dark` subtree, so what the reader sees is the dark surface, not a light one
 * mislabelled.
 */
function ModalSpecimens({ pane }: { pane: HTMLElement | null }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Cell label="Dialog — dismissible">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Прикрепить запись</Button>
          </DialogTrigger>
          <DialogContent container={pane}>
            <DialogHeader>
              <DialogTitle>Прикрепить запись</DialogTitle>
              <DialogDescription>
                Провайдер и идентификатор встраивания. Форму можно закрыть,
                ничего не выбрав — Escape, крестик или клик вне окна.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Отмена</Button>
              <Button>Прикрепить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Cell>
      <Cell label="AlertDialog — must be answered">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Отозвать запись</Button>
          </AlertDialogTrigger>
          <AlertDialogContent container={pane}>
            <AlertDialogHeader>
              <AlertDialogTitle>Отозвать запись?</AlertDialogTitle>
              <AlertDialogDescription>
                Запись перестанет показываться и освободит слот своего вида. Её
                можно будет восстановить — действие обратимо.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction>Отозвать</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Cell>
    </div>
  );
}

function DialogSection() {
  // One ref per theme pane: `ThemePair` renders its tree twice, so a single
  // shared ref would point at whichever pane mounted last and send the light
  // specimen's portal into the dark pane.
  const [lightPane, setLightPane] = useState<HTMLElement | null>(null);
  const [darkPane, setDarkPane] = useState<HTMLElement | null>(null);

  return (
    <PrimitiveSection
      title="Dialog / AlertDialog"
      exportsLine="Dialog · DialogTrigger · DialogContent · DialogHeader · DialogFooter · DialogTitle · DialogDescription · DialogClose — AlertDialog · AlertDialogTrigger · AlertDialogContent · AlertDialogHeader · AlertDialogFooter · AlertDialogTitle · AlertDialogDescription · AlertDialogAction · AlertDialogCancel"
    >
      <p className="text-sm text-muted-foreground">
        The official shadcn/ui dialog and alert-dialog on their Radix substrate,
        re-skinned to the DS tokens. They look alike and behave differently on
        purpose: <code className="font-mono text-xs">Dialog</code> is the
        walk-away surface (Escape, the scrim, a named × affordance), while{" "}
        <code className="font-mono text-xs">AlertDialog</code> takes{" "}
        <code className="font-mono text-xs">role=&quot;alertdialog&quot;</code>,
        refuses an outside press and lands initial focus on Cancel — so a
        consequential action is chosen, never clicked away. Open one in each
        pane to read the scrim and the focus ring; the scrim is theme-invariant
        black because a foreground-keyed veil would flip to white in the dark
        theme.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(["light", "dark"] as const).map((theme) => (
          <div
            key={theme}
            ref={theme === "light" ? setLightPane : setDarkPane}
            className={
              "relative flex flex-col items-start gap-4 border-2 border-border bg-background p-6 " +
              theme
            }
          >
            <span className="font-mono text-xs text-muted-foreground">
              {theme}
            </span>
            <ModalSpecimens pane={theme === "light" ? lightPane : darkPane} />
          </div>
        ))}
      </div>
    </PrimitiveSection>
  );
}

/** Neutral mock roster for the Sheet specimens — numbered entries, no persons. */
const SHEET_RECORDS = [
  { no: 1041, specialty: "Терапия", city: "Казань", status: "Подтверждена" },
  { no: 1042, specialty: "Кардиология", city: "Пермь", status: "Ожидает" },
  { no: 1043, specialty: "Неврология", city: "Томск", status: "Подтверждена" },
  { no: 1044, specialty: "Педиатрия", city: "Самара", status: "Отменена" },
  { no: 1045, specialty: "Эндокринология", city: "Омск", status: "Ожидает" },
  { no: 1046, specialty: "Хирургия", city: "Уфа", status: "Подтверждена" },
  { no: 1047, specialty: "Терапия", city: "Тула", status: "Подтверждена" },
  { no: 1048, specialty: "Кардиология", city: "Орёл", status: "Ожидает" },
  { no: 1049, specialty: "Неврология", city: "Курск", status: "Подтверждена" },
  { no: 1050, specialty: "Педиатрия", city: "Псков", status: "Ожидает" },
  { no: 1051, specialty: "Эндокринология", city: "Тверь", status: "Отменена" },
  { no: 1052, specialty: "Хирургия", city: "Киров", status: "Подтверждена" },
] as const;

/**
 * A bounded stage the Sheet portals into. `transform-gpu` makes the stage the
 * containing block of the sheet's `position: fixed` panel and scrim, so the
 * specimen docks to the STAGE edge (with the roster behind it) instead of
 * covering the whole catalogue. Modality still follows the real viewport: at
 * >= lg the panel is the non-modal inspector, below lg the modal full cover.
 */
function SheetStage({
  label,
  onStage,
  children,
}: {
  label: string;
  onStage: (node: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" data-sheet-stage={label}>
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <div
        ref={onStage}
        className="relative h-120 transform-gpu overflow-hidden border-2 border-border bg-background"
      >
        {children}
      </div>
    </div>
  );
}

/** Read card: roster behind, click a row to inspect, ↑/↓ pages the records. */
function SheetInspectorDemo() {
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const record = index === null ? null : SHEET_RECORDS[index];

  function navigate(direction: SheetNavigateDirection) {
    setIndex((i) => {
      if (i === null) return i;
      const next = direction === "next" ? i + 1 : i - 1;
      return Math.min(Math.max(next, 0), SHEET_RECORDS.length - 1);
    });
  }

  return (
    <SheetStage
      label="inspector — read card, ↑/↓ between records"
      onStage={setStage}
    >
      <div className="h-full overflow-y-auto">
        <table className="w-full border-collapse text-sm text-foreground">
          <thead>
            <tr className="border-b-2 border-border text-left">
              <th className="p-3 font-semibold">Заявка</th>
              <th className="p-3 font-semibold">Специальность</th>
              <th className="p-3 font-semibold">Город</th>
              <th className="p-3 font-semibold">Статус</th>
            </tr>
          </thead>
          <tbody>
            {SHEET_RECORDS.map((r, i) => (
              <tr
                key={r.no}
                data-selected={i === index ? "true" : undefined}
                className="border-b border-border data-selected:bg-tint data-selected:text-tint-foreground"
              >
                <td className="p-3">
                  <Button variant="link" onClick={() => setIndex(i)}>
                    {`Заявка №${r.no}`}
                  </Button>
                </td>
                <td className="p-3">{r.specialty}</td>
                <td className="p-3">{r.city}</td>
                <td className="p-3">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet
        open={record !== null}
        onOpenChange={(open) => {
          if (!open) setIndex(null);
        }}
      >
        <SheetContent container={stage} onNavigate={navigate}>
          <SheetHeader>
            <SheetTitle>{record ? `Заявка №${record.no}` : ""}</SheetTitle>
            <SheetDescription>
              ↑/↓ — соседняя заявка, Escape или × — закрыть.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {record ? (
              <dl className="flex flex-col gap-4 text-sm">
                {[
                  ["Специальность", record.specialty],
                  ["Город", record.city],
                  ["Статус", record.status],
                  ["Источник", "Форма на сайте конгресса"],
                  ["Дни участия", "Первый и второй день"],
                  [
                    "Комментарий",
                    "Длинное поле, чтобы показать: прокручивается только тело карточки, шапка остаётся на месте. ".repeat(
                      6,
                    ),
                  ],
                ].map(([term, value]) => (
                  <div key={term} className="flex flex-col gap-1">
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </SheetStage>
  );
}

/** Entry form: fields in SheetBody, Отмена/Сохранить pinned in SheetFooter. */
function SheetFormDemo() {
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const [size, setSize] = useState<"md" | "lg">("md");
  const id = useId();

  function openWith(nextSide: "right" | "left", nextSize: "md" | "lg") {
    setSide(nextSide);
    setSize(nextSize);
    setOpen(true);
  }

  return (
    <SheetStage
      label="form — body + footer actions; side / size"
      onStage={setStage}
    >
      <div className="flex flex-wrap items-start gap-3 p-6">
        <Button onClick={() => openWith("right", "md")}>Новая заявка</Button>
        <Button variant="outline" onClick={() => openWith("right", "lg")}>
          Справа, lg
        </Button>
        <Button variant="outline" onClick={() => openWith("left", "md")}>
          Слева, md
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent container={stage} side={side} size={size}>
          <SheetHeader>
            <SheetTitle>Новая заявка</SheetTitle>
            <SheetDescription>
              Регистрация участника за стойкой. Поля — в теле, действия — внизу.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <form
              id={`${id}-form`}
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setOpen(false);
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-specialty`}>Специальность</Label>
                <Input id={`${id}-specialty`} defaultValue="Терапия" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-city`}>Город</Label>
                <Input id={`${id}-city`} defaultValue="Казань" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-email`}>Эл. почта</Label>
                <Input
                  id={`${id}-email`}
                  type="email"
                  placeholder="name@example.org"
                />
              </div>
            </form>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="outline">Отмена</Button>
            </SheetClose>
            <Button type="submit" form={`${id}-form`}>
              Сохранить
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </SheetStage>
  );
}

function SheetSection() {
  return (
    <PrimitiveSection
      title="Sheet"
      exportsLine="Sheet · SheetTrigger · SheetContent · SheetHeader · SheetBody · SheetFooter · SheetTitle · SheetDescription · SheetClose"
    >
      <p className="text-sm text-muted-foreground">
        The official shadcn/ui sheet on the Radix Dialog substrate, re-skinned
        to the DS tokens — the side panel for a record card or an entry form.
        From <code className="font-mono text-xs">lg</code> it is a non-modal
        inspector docked to the edge: the list behind stays visible, scrollable
        and clickable, and choosing another row keeps the panel open. Below{" "}
        <code className="font-mono text-xs">lg</code> it becomes a modal full
        cover with a scrim. Escape or × closes it;{" "}
        <code className="font-mono text-xs">onNavigate</code> pages records on
        ↑/↓. Only <code className="font-mono text-xs">SheetBody</code> scrolls.
        Each stage is its own positioning frame, so the specimen docks to the
        stage, not the window; it follows the page theme toggle.
      </p>
      <SheetInspectorDemo />
      <SheetFormDemo />
    </PrimitiveSection>
  );
}

export function PrimitivesView() {
  return (
    <div className="flex flex-col gap-2">
      <ButtonSection />
      <LinkSection />
      <InputSection />
      <NativeSelectSection />
      <TextareaSection />
      <MediaDropzoneSection />
      <LabelSection />
      <CardSection />
      <TabsSection />
      <DialogSection />
      <SheetSection />
      <OtpSection />
      <FormPrimitivesSection />
      <FieldsSection />
      <FieldStatesSection />
      <FilterChipSection />
      <BadgeSection />
      <AvatarSection />
      <CheckboxSection />
      <RadioSection />
      <SwitchSection />
      <AlertSection />
      <SkeletonSection />
      <ContactChipSection />
      <DayBandSection />
      <EventsFilterSection />
      <WebinarCardSection />
      <WebinarPageContentSection />
      <WebinarStatusCardSection />
      <WebinarRecordingPlaqueSection />
      <RecordingSpoilerSection />
      <WebinarRoomSection />
      <ContainerSection />
    </div>
  );
}
