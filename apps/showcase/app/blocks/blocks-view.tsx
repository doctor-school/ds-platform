"use client";

import { type ReactNode } from "react";
import { useForm, type FieldValues } from "react-hook-form";

import {
  AuthCard,
  AuthLayout,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import { Form, FormField } from "@ds/design-system/form";
import { EmailField, PasswordField } from "@ds/design-system/fields";

/**
 * Blocks section (design-system-showcase spec §3.3). Each exported
 * `@ds/design-system` block — `AuthCard`, `AuthLayout`, `OtpFocusScreen` — is
 * presented as a **reusable unit**, the same unit-as-subject framing as Tokens
 * (§3.1) and Primitives (§3.2). After two corrected circles (#348 re-staged the
 * branded product screen — a MIRROR; #390 filled slots with raw prop NAMES — a
 * wireframe), the researched DS-doc middle ground (shadcn/ui Blocks · Storybook
 * autodocs · MUI · Carbon) and the owner's Stage-A pick (#386, Layout = Stacked)
 * settle each block as, vertically:
 *
 *   1. a realistic-but-neutral live render — the REAL composed block with
 *      representative content ("Sign in" / "you@example.com"), never product
 *      marketing and never raw prop names;
 *   2. a slots/props table — the real contract (name · type · required · desc);
 *   3. a state matrix — the states a consumer must handle.
 *
 * The showcase is a VIEWER (spec §2.4): the blocks render their own real composed
 * primitives, branded by their own tokens (`AuthLayout`'s brand panel paints from
 * the semantic `primary-surface` token), and nothing is re-implemented. No usage
 * code snippet is fabricated — mature systems auto-extract code from source so it
 * cannot drift; a hand-typed one would be the drift opt-out, so it is omitted.
 */

/* ------------------------------------------------------------------ */
/* Shared chrome — mirrors the primitives view so all sections read alike */
/* ------------------------------------------------------------------ */

/** Section frame: a titled block with an export-name caption. */
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

/** A labelled sub-row inside a section (Preview / Slots / State matrix). */
function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A bordered canvas around a realistic render (the Storybook "preview" convention). */
function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center rounded-lg border border-border bg-muted p-8">
      {children}
    </div>
  );
}

type PropRow = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

/** The slots/props contract table — name · type · required · description. */
function PropsTable({ rows }: { rows: PropRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted">
            <th className="px-3 py-2 font-medium text-foreground">Slot / prop</th>
            <th className="px-3 py-2 font-medium text-foreground">Type</th>
            <th className="px-3 py-2 font-medium text-foreground">Required</th>
            <th className="px-3 py-2 font-medium text-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border last:border-0 align-top">
              <td className="px-3 py-2">
                <code className="font-mono text-xs text-foreground">{r.name}</code>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-xs text-muted-foreground">{r.type}</code>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {r.required ? "required" : "optional"}
              </td>
              <td className="px-3 py-2 text-sm text-muted-foreground">{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A labelled state-matrix cell — the state name (+ the prop that drives it) above its sample. */
function StateCase({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
        {note ? (
          // muted-foreground at full strength (the AA-safe quiet tier, #270); an
          // opacity modifier (`/70`) dims it below WCAG-AA and is caught by the
          // retargeted axe scan (#351).
          <span className="text-xs text-muted-foreground">{note}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** A neutral leading glyph for an `icon` / logo slot — illustrative, not a brand mark. */
function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-5 text-muted-foreground"}
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* AuthCard                                                             */
/* ------------------------------------------------------------------ */

const AUTH_CARD_PROPS: PropRow[] = [
  { name: "icon", type: "ReactNode", required: false, description: "Glyph rendered in a tint badge tile above the title." },
  { name: "title", type: "ReactNode", required: true, description: "Card title." },
  { name: "description", type: "ReactNode", required: false, description: "Sub-copy under the title." },
  { name: "children", type: "ReactNode", required: true, description: "App-owned form / body — composes any primitives." },
  { name: "footer", type: "ReactNode", required: false, description: "Secondary links (e.g. create account)." },
];

/** `AuthCard` with neutral-realistic content, composed from the real field primitives. */
function NeutralAuthCard({ className }: { className?: string }) {
  const form = useForm<FieldValues>({
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });
  return (
    <AuthCard
      className={className}
      icon={<LockGlyph className="text-tint-foreground" />}
      title="Sign in"
      description="Enter your details to continue."
      footer={
        <Link href="#" variant="standalone">
          Create an account
        </Link>
      }
    >
      <Form {...form}>
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
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
    </AuthCard>
  );
}

/** A compact required-only `AuthCard` (title + children) for the state matrix. */
function MinimalAuthCard() {
  const form = useForm<FieldValues>({ defaultValues: { email: "" }, mode: "onTouched" });
  return (
    <AuthCard className="w-full max-w-sm" title="Reset password">
      <Form {...form}>
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <FormField
            name="email"
            control={form.control}
            render={({ field }) => (
              <EmailField field={field} label="Email" placeholder="you@example.com" />
            )}
          />
          <Button type="submit" className="w-full">
            Send reset link
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}

function AuthCardSection() {
  return (
    <BlockSection
      title="AuthCard"
      exportsLine="AuthCard — slots: icon? · title · description? · children · footer? (token-only Card scaffold)"
    >
      <p className="text-sm text-muted-foreground">
        The owned presentation scaffold the four auth surfaces (login / register / reset /
        verify) compose into. It renders the real{" "}
        <code className="font-mono text-xs">Card</code> primitives; all copy, the form, and the
        icon are app-supplied — the block carries none of its own.
      </p>

      <SubRow label="Preview">
        <Canvas>
          <NeutralAuthCard className="w-full max-w-sm" />
        </Canvas>
      </SubRow>

      <SubRow label="Slots / props">
        <PropsTable rows={AUTH_CARD_PROPS} />
      </SubRow>

      <SubRow label="State matrix — optional-slot presence">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
          <StateCase label="all slots" note="icon + description + footer present">
            <Canvas>
              <NeutralAuthCard className="w-full max-w-sm" />
            </Canvas>
          </StateCase>
          <StateCase label="required only" note="title + children; icon / description / footer omitted">
            <Canvas>
              <MinimalAuthCard />
            </Canvas>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

/* ------------------------------------------------------------------ */
/* AuthLayout                                                           */
/* ------------------------------------------------------------------ */

const AUTH_LAYOUT_PROPS: PropRow[] = [
  { name: "logo", type: "ReactNode", required: false, description: "Brand lockup above the form card. On lg+ it is hidden when an aside is present (the panel carries the mark); with no aside it shows on every breakpoint." },
  { name: "aside", type: "ReactNode", required: false, description: "Brand-panel content (eyebrow / headline / sub-copy centered, footer pinned low). Present ⇒ two-column split at layout; omitted ⇒ centered form-only screen (panel not rendered)." },
  { name: "children", type: "ReactNode", required: true, description: "The auth form for this surface (an AuthCard)." },
];

/**
 * Neutral brand-panel content for the `aside` slot — representative, not product
 * marketing. Mirrors the canvas panel composition (#517, `auth.dc.html`): an eyebrow
 * (caps micro-label) + large headline + subcopy vertically CENTERED in the panel,
 * and a separate footer line pinned to the bottom. No logo lives in the demo panel
 * (the layout's `logo` slot above the card carries the mark) — #518 composes the
 * portal aside to this shape. The headline inherits the block's own white
 * `text-primary-surface-foreground`; the quiet tiers (eyebrow / subcopy / footer)
 * use the `text-primary-surface-muted` token — one visible weight below the white
 * headline, AA on the blue.700 panel in both themes (#537, replacing the prior
 * element `opacity-*` dim: a real token reads as a deliberate tier, not translucency).
 */
function NeutralAside() {
  return (
    <div className="flex h-full flex-col justify-between gap-8">
      <div className="flex flex-1 flex-col justify-center gap-5">
        <p className="text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
          Peer to peer
        </p>
        <p className="max-w-lg text-3xl font-extrabold leading-tight tracking-tight">
          Welcome back
        </p>
        <p className="max-w-md text-lg leading-snug text-primary-surface-muted">
          Sign in to pick up where you left off.
        </p>
      </div>
      <p className="text-sm font-semibold text-primary-surface-muted">Free · no red tape · © Acme</p>
    </div>
  );
}

/** Neutral logo lockup for the `logo` slot. */
function NeutralLogo() {
  return (
    <div className="flex items-center gap-2 font-semibold text-foreground">
      <LockGlyph className="size-5 text-foreground" />
      <span>Acme</span>
    </div>
  );
}

/** A compact `AuthCard` nested as the layout's `children` (the layout's real contract is "wraps an AuthCard"). */
function NestedAuthCard() {
  const form = useForm<FieldValues>({
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });
  return (
    <AuthCard
      icon={<LockGlyph className="text-tint-foreground" />}
      title="Sign in"
      description="Enter your details to continue."
      footer={
        <Link href="#" variant="standalone">
          Create an account
        </Link>
      }
    >
      <Form {...form}>
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
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
    </AuthCard>
  );
}

function AuthLayoutSection() {
  return (
    <BlockSection
      title="AuthLayout"
      exportsLine="AuthLayout — slots: logo? · aside? (brand panel) · children (AuthCard); aside present ⇒ split, absent ⇒ form-only"
    >
      <p className="text-sm text-muted-foreground">
        The split-screen chrome wrapping an{" "}
        <code className="font-mono text-xs">AuthCard</code>. The brand panel paints from the
        semantic <code className="font-mono text-xs">primary-surface</code> token (the block&apos;s
        own branding); the <code className="font-mono text-xs">logo</code> and the panel{" "}
        <code className="font-mono text-xs">aside</code> are app-supplied. The two-column split
        engages at the semantic <code className="font-mono text-xs">layout</code> breakpoint
        (≥901px, §09 — the token match for the canvas ≤900px fold); the block&apos;s{" "}
        <code className="font-mono text-xs">min-h-screen</code> is neutralised to{" "}
        <code className="font-mono text-xs">min-h-0</code> here so it sizes to content at catalogue
        scale.
      </p>

      <SubRow label="Preview">
        <div className="overflow-hidden rounded-lg border border-border">
          <AuthLayout className="min-h-0" logo={<NeutralLogo />} aside={<NeutralAside />}>
            <NestedAuthCard />
          </AuthLayout>
        </div>
      </SubRow>

      <SubRow label="Slots / props">
        <PropsTable rows={AUTH_LAYOUT_PROPS} />
      </SubRow>

      <SubRow label="State matrix — aside present vs omitted">
        <div className="flex flex-col gap-6">
          <StateCase label="aside present" note="branded split — brand panel (lg+) + form column">
            <div className="overflow-hidden rounded-lg border border-border">
              <AuthLayout className="min-h-0" logo={<NeutralLogo />} aside={<NeutralAside />}>
                <NestedAuthCard />
              </AuthLayout>
            </div>
          </StateCase>
          <StateCase label="aside omitted" note="form-only — logo on every breakpoint, panel not rendered">
            <div className="overflow-hidden rounded-lg border border-border">
              <AuthLayout className="min-h-0" logo={<NeutralLogo />}>
                <NestedAuthCard />
              </AuthLayout>
            </div>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

/* ------------------------------------------------------------------ */
/* OtpFocusScreen                                                       */
/* ------------------------------------------------------------------ */

const OTP_FOCUS_PROPS: PropRow[] = [
  { name: "field", type: "ControllerRenderProps", required: true, description: "RHF controller for the code field — the app owns the form/resolver." },
  { name: "length", type: "number", required: true, description: "Fixed code length (8 for login OTP, 6 for register/reset)." },
  { name: "variant", type: '"slotted" | "plain"', required: false, description: "OTP presentation — defaults to the unified slotted look." },
  { name: "title", type: "ReactNode", required: true, description: "Screen title (app-supplied, localized)." },
  { name: "sentToLabel", type: "ReactNode", required: true, description: 'Past-tense "code sent to {masked}" — app composes it with the pre-masked destination (maskDestination).' },
  { name: "codeLabel", type: "string", required: true, description: "Label for the code input." },
  { name: "submitLabel", type: "ReactNode", required: true, description: "Submit button copy." },
  { name: "resendLabel", type: "ReactNode", required: true, description: "Resend control copy while enabled." },
  { name: "resendCountdownLabel", type: "(s: number) => ReactNode", required: true, description: "Resend copy while counting down; receives remaining seconds." },
  { name: "changeMethodLabel", type: "ReactNode", required: true, description: "Change-method / back control copy." },
  { name: "cooldownSeconds", type: "number", required: false, description: "Resend cooldown; the countdown (re)starts when this value changes. 0 = enabled now." },
  { name: "resendNonce", type: "number", required: false, description: "Bump on each successful resend to restart the countdown without remounting the block." },
  { name: "isSubmitting", type: "boolean", required: false, description: "App-owned in-flight flag — disables submit + guards the auto-submit race." },
  { name: "error", type: "ReactNode", required: false, description: "Optional error slot (already-mapped, localized message)." },
  { name: "onSubmit", type: "FormEventHandler", required: true, description: "Manual submit handler (the form the app owns)." },
  { name: "onResend", type: "() => void", required: true, description: "Resend handler — the app re-requests the code and bumps the cooldown." },
  { name: "onChangeMethod", type: "() => void", required: true, description: "Change-method / back handler — returns the surface to channel selection." },
];

/** `OtpFocusScreen` with neutral-realistic copy; mounts its own RHF form to supply the `code` field. */
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
            title="Verify it's you"
            sentToLabel={`Code sent to ${maskDestination("doctor@example.com")}`}
            codeLabel="Verification code"
            submitLabel="Verify"
            resendLabel="Resend code"
            resendCountdownLabel={(s) => `Resend in ${s}s`}
            changeMethodLabel="Use another method"
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

/** Catalogue frame for an OtpFocusScreen sample — the surface composes it inside a card region. */
function OtpFrame({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-sm rounded-xl border border-border p-6">{children}</div>
  );
}

function OtpFocusScreenSection() {
  return (
    <BlockSection
      title="OtpFocusScreen"
      exportsLine="OtpFocusScreen — props: field · length · *Label copy · cooldownSeconds · resendNonce · isSubmitting · error"
    >
      <p className="text-sm text-muted-foreground">
        The focused OTP-entry block a surface swaps in once a code is issued: by construction it
        renders ONLY masked destination + code input + submit + resend(cooldown) + change-method,
        so the user cannot wander off the challenge. Every visible string is an app-supplied prop;
        the masked destination is computed by the app via{" "}
        <code className="font-mono text-xs">maskDestination</code>.
      </p>

      <SubRow label="Preview">
        <Canvas>
          <OtpFrame>
            <OtpFocusDemo cooldownSeconds={0} />
          </OtpFrame>
        </Canvas>
      </SubRow>

      <SubRow label="Slots / props">
        <PropsTable rows={OTP_FOCUS_PROPS} />
      </SubRow>

      <SubRow label="State matrix — resend cooldown · error · submitting">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
          <StateCase label="resend ready" note="cooldownSeconds = 0">
            <OtpFrame>
              <OtpFocusDemo cooldownSeconds={0} />
            </OtpFrame>
          </StateCase>
          <StateCase label="resend counting down" note="cooldownSeconds = 30">
            <OtpFrame>
              <OtpFocusDemo cooldownSeconds={30} />
            </OtpFrame>
          </StateCase>
          <StateCase label="error" note="error slot populated">
            <OtpFrame>
              <OtpFocusDemo cooldownSeconds={30} error="That code is incorrect." />
            </OtpFrame>
          </StateCase>
          <StateCase label="submitting" note="isSubmitting — submit disabled">
            <OtpFrame>
              <OtpFocusDemo cooldownSeconds={30} isSubmitting />
            </OtpFrame>
          </StateCase>
        </div>
      </SubRow>
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
