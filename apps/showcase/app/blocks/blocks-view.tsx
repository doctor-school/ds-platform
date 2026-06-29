"use client";

import { type ReactNode } from "react";
import { useForm, type FieldValues } from "react-hook-form";

import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import { Input } from "@ds/design-system/input";
import { Form, FormField } from "@ds/design-system/form";
import { EmailField, PasswordField } from "@ds/design-system/fields";
import {
  AuthCard,
  AuthLayout,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";

/**
 * Blocks section (design-system-showcase spec §3.3). Each exported
 * `@ds/design-system` block — `AuthCard`, `AuthLayout`, `OtpFocusScreen` — is
 * rendered as the REAL composed block in its key states, branded. The showcase
 * re-implements nothing (spec §2.4): the blocks compose their own real primitives,
 * and this view supplies only the representative, i18n-free sample content the app
 * layer would otherwise own (copy / logo / form glue), exactly as the product apps
 * pass it in (the blocks carry no copy of their own).
 *
 * Branding is the blocks' own token wiring: `AuthLayout`'s brand panel paints from
 * the semantic `primary-surface` token, the `AuthCard` chrome from the card tokens —
 * never an app-local colour. The sample logo is a token-styled text wordmark (the
 * showcase owns no brand asset and must not reach into a product app's `public/`).
 */

/** Section frame: a titled block with an export-name caption — mirrors the
 *  primitives view so the two read identically. */
function BlockSection({
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

/** A labelled state cell — the state name above its rendered block sample. */
function StateCase({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Sample brand lockup — a token-styled text wordmark standing in for the app's
 * supplied logo. The showcase deliberately owns no brand asset (it is a viewer of
 * the design system, not the brand); the wordmark uses only tokens, so it carries
 * the brand colour without a raster/SVG dependency on a product app.
 */
function SampleLogo({ onPanel = false }: { onPanel?: boolean }) {
  return (
    <span
      className={`text-lg font-semibold tracking-tight ${
        onPanel ? "text-primary-foreground" : "text-primary"
      }`}
    >
      Doctor School
    </span>
  );
}

/** A representative lucide-style shield-check glyph for the AuthCard header icon,
 *  inlined so the showcase adds no icon-library dependency. Token-coloured. */
function ShieldGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 text-primary"
      aria-hidden
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Representative AuthCard footer — secondary links, exactly the app's footer shape. */
function SampleFooter() {
  return (
    <>
      <Link asChild>
        <a href="#register">Create an account</a>
      </Link>
      <Link asChild>
        <a href="#reset">Forgot your password?</a>
      </Link>
    </>
  );
}

/**
 * Representative sign-in form body — composes the real `EmailField` / `PasswordField`
 * primitives in their own RHF context, so the `AuthCard` content slot renders exactly
 * what an auth surface nests. `preventDefault` keeps the showcase a pure viewer (no
 * BFF). Not a re-implementation: these are the package's own field primitives.
 */
function SampleSignInForm() {
  const form = useForm<FieldValues>({
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });
  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => (
            <EmailField field={field} label="Email" placeholder="you@example.com" />
          )}
        />
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => (
            <PasswordField field={field} purpose="current" label="Password" />
          )}
        />
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </Form>
  );
}

function AuthCardSection() {
  return (
    <BlockSection
      title="AuthCard"
      exportsLine="AuthCard — the owned auth screen-scaffold (icon · title · description · content · footer)"
    >
      <p className="text-sm text-muted-foreground">
        Presentation scaffold for the four auth surfaces (login / register / reset /
        verify). All copy, the icon and the footer links are app-supplied — shown here
        with representative content composing the real field primitives.
      </p>
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
        <StateCase label="full (icon + description + footer)">
          <AuthCard
            icon={<ShieldGlyph />}
            title="Sign in"
            description="Use your email and password, or request a one-time code."
            footer={<SampleFooter />}
            className="max-w-md"
          >
            <SampleSignInForm />
          </AuthCard>
        </StateCase>
        <StateCase label="minimal (title + content only)">
          <AuthCard title="Reset your password" className="max-w-md">
            <p className="text-sm text-foreground">
              Enter the email associated with your account and we will send a reset
              code.
            </p>
            <div className="mt-4">
              <Input className="w-full" placeholder="you@example.com" />
            </div>
          </AuthCard>
        </StateCase>
      </div>
    </BlockSection>
  );
}

/**
 * Representative brand-panel content for `AuthLayout`'s `aside` — the localized
 * headline / sub-copy / footer the app supplies, here as i18n-free sample copy on the
 * block's own `primary-surface` token fill (the panel owns the branding).
 */
function SampleAside() {
  return (
    <>
      <SampleLogo onPanel />
      <div className="flex flex-1 flex-col justify-center space-y-4">
        <p className="max-w-lg text-4xl font-semibold leading-tight tracking-tight">
          Medical education that moves with you.
        </p>
        <p className="max-w-md text-lg leading-snug opacity-90">
          Accredited courses from leading sponsors, built for practising doctors.
        </p>
      </div>
      <p className="text-sm opacity-80">© Doctor School</p>
    </>
  );
}

/**
 * `AuthLayout` is a full-screen split (`min-h-screen`, two columns on `lg+`). Each
 * sample is rendered inside a bordered preview frame; the block's own `min-h-screen`
 * is neutralised to `min-h-0` via the passed `className` (tailwind-merge keeps the
 * last `min-h-*`), so the block sizes to its content at a catalogue scale instead of
 * forcing a full viewport height. The two-column split appears at a desktop (`lg+`)
 * viewport — narrower viewports collapse to the form-only column exactly as the real
 * surface does. `min-h-0` is token-safe (no arbitrary value, §5 lint).
 */
function AuthLayoutSection() {
  return (
    <BlockSection
      title="AuthLayout"
      exportsLine="AuthLayout — split-screen auth chrome (brand panel + centered form column)"
    >
      <p className="text-sm text-muted-foreground">
        Wraps an <code className="font-mono text-xs">AuthCard</code>. With an{" "}
        <code className="font-mono text-xs">aside</code> it is the branded
        split-screen (brand panel left, form right on lg+); without one it is a
        centered form-only screen. Logo and panel copy are app-supplied.
      </p>

      <StateCase label="branded split (logo + aside + AuthCard)">
        <div className="overflow-hidden rounded-xl border border-border">
          <AuthLayout
            className="min-h-0"
            logo={<SampleLogo />}
            aside={<SampleAside />}
          >
            <AuthCard
              icon={<ShieldGlyph />}
              title="Sign in"
              description="Use your email and password, or request a one-time code."
              footer={<SampleFooter />}
            >
              <SampleSignInForm />
            </AuthCard>
          </AuthLayout>
        </div>
      </StateCase>

      <StateCase label="form-only (no aside — logo on every breakpoint)">
        <div className="overflow-hidden rounded-xl border border-border">
          <AuthLayout className="min-h-0" logo={<SampleLogo />}>
            <AuthCard title="Reset your password">
              <p className="text-sm text-foreground">
                Enter the email associated with your account and we will send a reset
                code.
              </p>
              <div className="mt-4">
                <Input className="w-full" placeholder="you@example.com" />
              </div>
            </AuthCard>
          </AuthLayout>
        </div>
      </StateCase>
    </BlockSection>
  );
}

/**
 * `OtpFocusScreen` demo wrapper. The block takes an RHF `field` (the app owns the
 * form), so each sample mounts its own `<Form>` + `<FormField>` to supply a real
 * `code` field — the same wiring the login surface uses. Handlers are no-op
 * `preventDefault` / no-op callbacks (pure viewer). `cooldownSeconds` /
 * `isSubmitting` / `error` drive the state shown.
 */
function OtpFocusDemo({
  cooldownSeconds = 0,
  isSubmitting = false,
  error,
}: {
  cooldownSeconds?: number;
  isSubmitting?: boolean;
  error?: ReactNode;
}) {
  const form = useForm<FieldValues>({
    defaultValues: { code: "" },
    mode: "onTouched",
  });
  return (
    <Form {...form}>
      <FormField
        name="code"
        control={form.control}
        render={({ field }) => (
          <OtpFocusScreen
            field={field}
            length={8}
            variant="slotted"
            title="Enter your code"
            sentToLabel={`Code sent to ${maskDestination("doctor@example.com")}`}
            codeLabel="Verification code"
            submitLabel="Verify and sign in"
            resendLabel="Resend code"
            resendCountdownLabel={(seconds) => `Resend in ${seconds}s`}
            changeMethodLabel="Change method"
            cooldownSeconds={cooldownSeconds}
            isSubmitting={isSubmitting}
            error={error}
            onSubmit={(e) => e.preventDefault()}
            onResend={() => {}}
            onChangeMethod={() => {}}
          />
        )}
      />
    </Form>
  );
}

function OtpFocusScreenSection() {
  return (
    <BlockSection
      title="OtpFocusScreen"
      exportsLine="OtpFocusScreen — focused OTP-entry block (masked destination · code · submit · resend cooldown · change-method)"
    >
      <p className="text-sm text-muted-foreground">
        Replaces the request chrome once a code is issued: masked destination, code box
        (auto-submits on completion), resend-with-cooldown and change-method — and by
        construction nothing else, so the user cannot wander off the challenge. Shown in
        a card frame as the surface composes it.
      </p>
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
        <StateCase label="resend ready (cooldown 0)">
          <div className="max-w-sm rounded-xl border border-border p-6">
            <OtpFocusDemo cooldownSeconds={0} />
          </div>
        </StateCase>
        <StateCase label="resend counting down">
          <div className="max-w-sm rounded-xl border border-border p-6">
            <OtpFocusDemo cooldownSeconds={30} />
          </div>
        </StateCase>
        <StateCase label="error (mapped message in slot)">
          <div className="max-w-sm rounded-xl border border-border p-6">
            <OtpFocusDemo cooldownSeconds={30} error="That code is incorrect." />
          </div>
        </StateCase>
        <StateCase label="submitting (submit disabled)">
          <div className="max-w-sm rounded-xl border border-border p-6">
            <OtpFocusDemo cooldownSeconds={30} isSubmitting />
          </div>
        </StateCase>
      </div>
    </BlockSection>
  );
}

export function BlocksView() {
  return (
    <div className="flex flex-col gap-2">
      <AuthCardSection />
      <AuthLayoutSection />
      <OtpFocusScreenSection />
    </div>
  );
}
