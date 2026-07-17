"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";

import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import { Input } from "@ds/design-system/input";
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
import { FilterChip } from "@ds/design-system/filter-chip";
import { Badge } from "@ds/design-system/badge";
import { Avatar } from "@ds/design-system/avatar";
import { Checkbox } from "@ds/design-system/checkbox";
import { Radio } from "@ds/design-system/radio";
import { Switch } from "@ds/design-system/switch";
import { Alert } from "@ds/design-system/alert";
import { Skeleton } from "@ds/design-system/skeleton";
import { DayBand } from "@ds/design-system/day-band";
import { WebinarCard } from "@ds/design-system/webinar-card";
import { WebinarPageContent } from "@ds/design-system/webinar-page-content";
import { WebinarStatusCard } from "@ds/design-system/webinar-status-card";
import { WebinarRoomLayout } from "@ds/design-system/webinar-room";
import { Container } from "@ds/design-system/container";
import {
  Form,
  FormControl,
  FormDescription,
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
    </PrimitiveSection>
  );
}

/** Inline variant of StateColumns for links sitting in running text. */
function StateColumnsInline({
  states,
  render,
}: {
  states: StateSpec[];
  render: (state: string) => ReactNode;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {states.map((s) => (
        <span key={s.name} className="inline-flex items-baseline gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
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
    </PrimitiveSection>
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
      exportsLine="Checkbox — state (real native checkbox)"
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
            </div>
          )}
        />
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
        <code className="font-mono text-xs">calendar</code> 1240px content) and applies
        the responsive gutter. Below the{" "}
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

function WebinarCardSection() {
  return (
    <PrimitiveSection
      title="Webinar-card"
      exportsLine="WebinarCard — listing unit (time plate · chips · speakers), stretched title link + optional room CTA"
    >
      <p className="text-sm text-muted-foreground">
        The §09 listing unit (source{" "}
        <code className="font-mono text-xs">webinar-card.dc.html</code>): a
        tinted 196px time plate (56px display time, explicit МСК label) and the
        content column (school kicker, title, specialty chips, speakers). The
        card root is a container and the title is a stretched link, so the whole
        card opens its event page while a second action can sit alongside without
        nesting anchors. Desktop → the bordered, raised grid; ≤900px → flat
        full-bleed with a bottom divider. Resize to watch the split. The{" "}
        <span className="font-medium text-foreground">live</span> variant
        surfaces the «В эфире» signal; the{" "}
        <span className="font-medium text-foreground">live + room-CTA</span>{" "}
        variant (006 EARS-6, «мои события») adds the sibling «Войти в эфир»
        room-entry button that routes to <code className="font-mono text-xs">
          /webinars/:slug/room
        </code>.
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
    </PrimitiveSection>
  );
}

function WebinarPageContentSection() {
  return (
    <PrimitiveSection
      title="Webinar-page-content"
      exportsLine="WebinarPageContent — event-page body (description · program PDF · sponsor plate · speakers)"
    >
      <p className="text-sm text-muted-foreground">
        The event-page content set (source{" "}
        <code className="font-mono text-xs">webinar-page.dc.html</code>, 004
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
        <code className="font-mono text-xs">webinar-page.dc.html</code>, 004
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

function WebinarRoomSection() {
  // A static demo of the composition shell — a placeholder player frame (no real
  // embed iframe in the showcase), the event context, and the chat aside shell.
  const playerFrame = (
    <div className="relative aspect-video border-2 border-border bg-neutral-950 shadow-lg">
      <Badge variant="live" className="absolute left-5 top-5">
        В эфире
      </Badge>
      <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300">
        Плеер эфира
      </div>
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
      <div className="border-b-2 border-border bg-primary-action px-4 py-3 text-center text-sm font-extrabold text-primary-foreground">
        Чат
      </div>
      <div className="border-b-2 border-border bg-tint px-4 py-3 text-caption leading-relaxed text-tint-foreground">
        📌 Модератор: вопросы можно задавать прямо в чате.
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
        Пока нет сообщений.
      </div>
      <div className="flex gap-3 border-t-2 border-border p-4">
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
      exportsLine="WebinarRoomLayout — the webinar room composition shell (player + chat aside; mobile Чат / О эфире tabs)"
    >
      <p className="text-sm text-muted-foreground">
        The webinar room layout (source{" "}
        <code className="font-mono text-xs">webinar-room.dc.html</code>, 006
        EARS-2/EARS-11): desktop a{" "}
        <code className="font-mono text-xs">1fr 400px</code> grid (player +
        context left, chat aside right); mobile a full-bleed player + Чат / О
        эфире tabs. The embed player is instantiated from the explicit provider
        enum (never URL-sniffed); the chat aside is the composition shell
        (behaviour is EARS-3).
      </p>
      <SubRow label="composition">
        <ThemePair
          render={() => (
            <div className="w-full">
              <WebinarRoomLayout
                chatTabLabel="Чат"
                infoTabLabel="О эфире"
                player={playerFrame}
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

export function PrimitivesView() {
  return (
    <div className="flex flex-col gap-2">
      <ButtonSection />
      <LinkSection />
      <InputSection />
      <LabelSection />
      <CardSection />
      <TabsSection />
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
      <DayBandSection />
      <WebinarCardSection />
      <WebinarPageContentSection />
      <WebinarStatusCardSection />
      <WebinarRoomSection />
      <ContainerSection />
    </div>
  );
}
