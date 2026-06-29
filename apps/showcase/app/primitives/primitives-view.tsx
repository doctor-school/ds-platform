"use client";

import { useEffect, type ReactNode } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ds/design-system/tabs";
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
 * pointer-only state. It MIRRORS the exported `interactiveBase` focus contract
 * (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
 * focus-visible:ring-offset-2`, see `@ds/design-system` → `interactive-base.ts`)
 * with the `focus-visible:` prefixes dropped so it paints unconditionally.
 *
 * Written as a LITERAL (not `interactiveBase.replace(...)`): Tailwind's content
 * scanner only emits utilities it sees as literal strings, so a runtime-computed
 * class string would silently fail to generate. `ring-ring` resolves to the
 * `--color-ring` token, so the ring stays token-driven and matches the real
 * focus ring; keep this in sync if the `interactiveBase` ring ever changes.
 */
const FORCED_FOCUS =
  "outline-none ring-2 ring-ring ring-offset-2 ring-offset-background";

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
            data-showcase-force={POINTER_STATES.has(s.name) ? s.name : undefined}
          >
            {render(s.name)}
          </div>
          {s.note ? (
            <span className="max-w-48 text-xs text-muted-foreground/70">
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
              <Button size={size} aria-label={size === "icon" ? "icon" : undefined}>
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
    <PrimitiveSection title="Label" exportsLine="Label — default / peer-disabled">
      <div className="flex flex-wrap gap-8">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">default</span>
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
          <InputOTP maxLength={6} value="123456" readOnly onChange={() => {}}>
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
          <InputOTP maxLength={4} value="" onChange={() => {}}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">disabled</span>
          <InputOTP maxLength={4} value="12" disabled onChange={() => {}}>
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

function FieldGrid({ label, children }: { label: string; children: ReactNode }) {
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
                <FormDescription>
                  Shown on your public profile.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
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
    </div>
  );
}
