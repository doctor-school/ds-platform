"use client";

import { type ReactNode, useState } from "react";
import { useForm, type FieldValues } from "react-hook-form";

import {
  AuthCard,
  AuthLayout,
  Combobox,
  DataTable,
  DayAgenda,
  EmptyState,
  EventList,
  FilterBar,
  FormActions,
  FormDerivedNote,
  FormFieldGroup,
  FormSection,
  FormSeparator,
  MonthCalendarGrid,
  MonthDotGrid,
  MonthPicker,
  OtpFocusScreen,
  Pagination,
  maskDestination,
  type ComboboxOption,
  type DataTableColumn,
  type DotGridCell,
  type EventListTab,
  type MonthGridCell,
  type MonthPickerCell,
} from "@ds/design-system/blocks";
import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { Input } from "@ds/design-system/input";
import { Label } from "@ds/design-system/label";
import { Link } from "@ds/design-system/link";
import { NativeSelect } from "@ds/design-system/native-select";
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
    // `min-w-0` + `max-w-full`: a grid/flex item defaults to `min-width: auto`, so a wide
    // specimen grew the cell past a 390px viewport and pushed the PAGE sideways instead of
    // scrolling inside its own canvas.
    <div className="flex min-w-0 max-w-full justify-center overflow-x-auto rounded-lg border border-border bg-muted p-8">
      {children}
    </div>
  );
}

/** The same canvas for a specimen that must fill the row rather than sit centred. */
function WideCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-muted p-8">
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
    // `overflow-x-auto`, not `overflow-hidden`: the doc table's four columns exceed a
    // 390px viewport, and without its own scroller the widest section pushed the whole
    // PAGE into horizontal overflow (documentWidth 570 vs innerWidth 390).
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted">
            <th className="px-3 py-2 font-medium text-foreground">
              Slot / prop
            </th>
            <th className="px-3 py-2 font-medium text-foreground">Type</th>
            <th className="px-3 py-2 font-medium text-foreground">Required</th>
            <th className="px-3 py-2 font-medium text-foreground">
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.name}
              className="border-b border-border last:border-0 align-top"
            >
              <td className="px-3 py-2">
                <code className="font-mono text-xs text-foreground">
                  {r.name}
                </code>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-xs text-muted-foreground">
                  {r.type}
                </code>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {r.required ? "required" : "optional"}
              </td>
              <td className="px-3 py-2 text-sm text-muted-foreground">
                {r.description}
              </td>
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
    // `min-w-0`: the matrix cell is a grid item, and its `min-width: auto` default let a
    // wide specimen grow the cell past the viewport instead of scrolling inside itself.
    <div className="flex min-w-0 flex-col gap-2">
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
  {
    name: "icon",
    type: "ReactNode",
    required: false,
    description: "Glyph rendered in a tint badge tile above the title.",
  },
  {
    name: "title",
    type: "ReactNode",
    required: true,
    description: "Card title.",
  },
  {
    name: "description",
    type: "ReactNode",
    required: false,
    description: "Sub-copy under the title.",
  },
  {
    name: "children",
    type: "ReactNode",
    required: true,
    description: "App-owned form / body — composes any primitives.",
  },
  {
    name: "footer",
    type: "ReactNode",
    required: false,
    description: "Secondary links (e.g. create account).",
  },
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
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <FormField
            name="email"
            control={form.control}
            render={({ field }) => (
              <EmailField
                field={field}
                label="Email"
                placeholder="you@example.com"
              />
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
  const form = useForm<FieldValues>({
    defaultValues: { email: "" },
    mode: "onTouched",
  });
  return (
    <AuthCard className="w-full max-w-sm" title="Reset password">
      <Form {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <FormField
            name="email"
            control={form.control}
            render={({ field }) => (
              <EmailField
                field={field}
                label="Email"
                placeholder="you@example.com"
              />
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
        The owned presentation scaffold the four auth surfaces (login / register
        / reset / verify) compose into. It renders the real{" "}
        <code className="font-mono text-xs">Card</code> primitives; all copy,
        the form, and the icon are app-supplied — the block carries none of its
        own.
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
          <StateCase
            label="all slots"
            note="icon + description + footer present"
          >
            <Canvas>
              <NeutralAuthCard className="w-full max-w-sm" />
            </Canvas>
          </StateCase>
          <StateCase
            label="required only"
            note="title + children; icon / description / footer omitted"
          >
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
  {
    name: "logo",
    type: "ReactNode",
    required: false,
    description:
      "Brand lockup above the form card. On lg+ it is hidden when an aside is present (the panel carries the mark); with no aside it shows on every breakpoint.",
  },
  {
    name: "aside",
    type: "ReactNode",
    required: false,
    description:
      "Brand-panel content (eyebrow / headline / sub-copy centered, footer pinned low). Present ⇒ two-column split at layout; omitted ⇒ centered form-only screen (panel not rendered).",
  },
  {
    name: "children",
    type: "ReactNode",
    required: true,
    description: "The auth form for this surface (an AuthCard).",
  },
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
      <p className="text-sm font-semibold text-primary-surface-muted">
        Free · no red tape · © Acme
      </p>
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
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <FormField
            name="email"
            control={form.control}
            render={({ field }) => (
              <EmailField
                field={field}
                label="Email"
                placeholder="you@example.com"
              />
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
        <code className="font-mono text-xs">AuthCard</code>. The brand panel
        paints from the semantic{" "}
        <code className="font-mono text-xs">primary-surface</code> token (the
        block&apos;s own branding); the{" "}
        <code className="font-mono text-xs">logo</code> and the panel{" "}
        <code className="font-mono text-xs">aside</code> are app-supplied. The
        two-column split engages at the semantic{" "}
        <code className="font-mono text-xs">layout</code> breakpoint (≥901px,
        §09 — the token match for the canvas ≤900px fold); the block&apos;s{" "}
        <code className="font-mono text-xs">min-h-screen</code> is neutralised
        to <code className="font-mono text-xs">min-h-0</code> here so it sizes
        to content at catalogue scale.
      </p>

      <SubRow label="Preview">
        <div className="overflow-hidden rounded-lg border border-border">
          <AuthLayout
            className="min-h-0"
            logo={<NeutralLogo />}
            aside={<NeutralAside />}
          >
            <NestedAuthCard />
          </AuthLayout>
        </div>
      </SubRow>

      <SubRow label="Slots / props">
        <PropsTable rows={AUTH_LAYOUT_PROPS} />
      </SubRow>

      <SubRow label="State matrix — aside present vs omitted">
        <div className="flex flex-col gap-6">
          <StateCase
            label="aside present"
            note="branded split — brand panel (lg+) + form column"
          >
            <div className="overflow-hidden rounded-lg border border-border">
              <AuthLayout
                className="min-h-0"
                logo={<NeutralLogo />}
                aside={<NeutralAside />}
              >
                <NestedAuthCard />
              </AuthLayout>
            </div>
          </StateCase>
          <StateCase
            label="aside omitted"
            note="form-only — logo on every breakpoint, panel not rendered"
          >
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
  {
    name: "field",
    type: "ControllerRenderProps",
    required: true,
    description:
      "RHF controller for the code field — the app owns the form/resolver.",
  },
  {
    name: "length",
    type: "number",
    required: true,
    description: "Fixed code length (8 for login OTP, 6 for register/reset).",
  },
  {
    name: "variant",
    type: '"slotted" | "plain"',
    required: false,
    description: "OTP presentation — defaults to the unified slotted look.",
  },
  {
    name: "title",
    type: "ReactNode",
    required: true,
    description: "Screen title (app-supplied, localized).",
  },
  {
    name: "sentToLabel",
    type: "ReactNode",
    required: true,
    description:
      'Past-tense "code sent to {masked}" — app composes it with the pre-masked destination (maskDestination).',
  },
  {
    name: "codeLabel",
    type: "string",
    required: true,
    description: "Label for the code input.",
  },
  {
    name: "submitLabel",
    type: "ReactNode",
    required: true,
    description: "Submit button copy.",
  },
  {
    name: "resendLabel",
    type: "ReactNode",
    required: true,
    description: "Resend control copy while enabled.",
  },
  {
    name: "resendCountdownLabel",
    type: "(s: number) => ReactNode",
    required: true,
    description: "Resend copy while counting down; receives remaining seconds.",
  },
  {
    name: "changeMethodLabel",
    type: "ReactNode",
    required: true,
    description: "Change-method / back control copy.",
  },
  {
    name: "cooldownSeconds",
    type: "number",
    required: false,
    description:
      "Resend cooldown; the countdown (re)starts when this value changes. 0 = enabled now.",
  },
  {
    name: "resendNonce",
    type: "number",
    required: false,
    description:
      "Bump on each successful resend to restart the countdown without remounting the block.",
  },
  {
    name: "isSubmitting",
    type: "boolean",
    required: false,
    description:
      "App-owned in-flight flag — disables submit + guards the auto-submit race.",
  },
  {
    name: "error",
    type: "ReactNode",
    required: false,
    description: "Optional error slot (already-mapped, localized message).",
  },
  {
    name: "onSubmit",
    type: "FormEventHandler",
    required: true,
    description: "Manual submit handler (the form the app owns).",
  },
  {
    name: "onResend",
    type: "() => void",
    required: true,
    description:
      "Resend handler — the app re-requests the code and bumps the cooldown.",
  },
  {
    name: "onChangeMethod",
    type: "() => void",
    required: true,
    description:
      "Change-method / back handler — returns the surface to channel selection.",
  },
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
            charset="numeric"
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
    <div className="max-w-sm rounded-xl border border-border p-6">
      {children}
    </div>
  );
}

function OtpFocusScreenSection() {
  return (
    <BlockSection
      title="OtpFocusScreen"
      exportsLine="OtpFocusScreen — props: field · length · *Label copy · cooldownSeconds · resendNonce · isSubmitting · error"
    >
      <p className="text-sm text-muted-foreground">
        The focused OTP-entry block a surface swaps in once a code is issued: by
        construction it renders ONLY masked destination + code input + submit +
        resend(cooldown) + change-method, so the user cannot wander off the
        challenge. Every visible string is an app-supplied prop; the masked
        destination is computed by the app via{" "}
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
              <OtpFocusDemo
                cooldownSeconds={30}
                error="That code is incorrect."
              />
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

/* ------------------------------------------------------------------ */
/* Month-calendar blocks (004 EARS-19)                                 */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

/** A neutral two-week desktop-grid sample exercising every cell variant. */
const GRID_WEEKS: MonthGridCell[][] = [
  [
    { dateLabel: "30", muted: true, mutedDate: true },
    { dateLabel: "1", note: "2 эфира · прошли" },
    { dateLabel: "2", note: "1 эфир · прошёл" },
    { dateLabel: "3" },
    {
      dateLabel: "4",
      pills: [
        { href: "#", time: "18:00", title: "Разбор клинического случая" },
      ],
    },
    { dateLabel: "5", muted: true, mutedDate: true },
    { dateLabel: "6", muted: true, mutedDate: true },
  ],
  [
    {
      dateLabel: "7 · сегодня",
      today: true,
      pills: [
        { href: "#", time: "19:00", title: "Прямой эфир", live: true },
        { href: "#", time: "20:30", title: "Новое в терапии" },
      ],
    },
    {
      dateLabel: "8",
      pills: [{ href: "#", time: "18:00", title: "Кардиология" }],
    },
    { dateLabel: "9" },
    { dateLabel: "10" },
    {
      dateLabel: "11",
      pills: [{ href: "#", time: "19:30", title: "Педиатрия" }],
    },
    { dateLabel: "12", muted: true, mutedDate: true },
    { dateLabel: "13", muted: true, mutedDate: true },
  ],
];

const GRID_LEGEND = {
  live: "В эфире",
  planned: "Запланирован",
  past: "Прошёл / пусто",
};

function MonthCalendarGridSection() {
  return (
    <BlockSection
      title="MonthCalendarGrid"
      exportsLine="MonthCalendarGrid — props: weekdays · weeks (MonthGridCell[][]) · liveLabel · legend (display-only desktop month grid)"
    >
      <p className="text-sm text-muted-foreground">
        The desktop pane of the webinars month view. Display-only: each day
        renders event pills (linking to the event page), a red live pill, or a
        muted past-day note; today is outlined; a state legend sits below. All
        data, copy, and hrefs are app-supplied.
      </p>
      <SubRow label="Preview">
        <div className="rounded-lg border border-border bg-muted p-8">
          <MonthCalendarGrid
            weekdays={WEEKDAYS}
            weeks={GRID_WEEKS}
            liveLabel="В эфире"
            legend={GRID_LEGEND}
          />
        </div>
      </SubRow>
    </BlockSection>
  );
}

/** A neutral two-week dot-grid sample; the section owns the selected-day state. */
const DOT_WEEKS: DotGridCell[][] = [
  [
    { day: 30, inMonth: false, dots: [], ariaLabel: "30" },
    {
      day: 1,
      inMonth: true,
      dots: ["past", "past"],
      ariaLabel: "1 — 2 эфира прошли",
    },
    { day: 2, inMonth: true, dots: ["past"], ariaLabel: "2 — 1 эфир прошёл" },
    { day: 3, inMonth: true, dots: [], ariaLabel: "3 — нет эфиров" },
    { day: 4, inMonth: true, dots: ["event"], ariaLabel: "4 — 1 эфир" },
    { day: 5, inMonth: true, dots: [], ariaLabel: "5 — нет эфиров" },
    { day: 6, inMonth: true, dots: [], ariaLabel: "6 — нет эфиров" },
  ],
  [
    {
      day: 7,
      inMonth: true,
      today: true,
      dots: ["live", "event"],
      ariaLabel: "7 июля, 2 эфира, идёт эфир",
    },
    { day: 8, inMonth: true, dots: ["event"], ariaLabel: "8 — 1 эфир" },
    { day: 9, inMonth: true, dots: [], ariaLabel: "9 — нет эфиров" },
    { day: 10, inMonth: true, dots: [], ariaLabel: "10 — нет эфиров" },
    { day: 11, inMonth: true, dots: ["event"], ariaLabel: "11 — 1 эфир" },
    { day: 12, inMonth: true, dots: [], ariaLabel: "12 — нет эфиров" },
    { day: 13, inMonth: true, dots: [], ariaLabel: "13 — нет эфиров" },
  ],
];

function MonthDotGridSection() {
  const [selected, setSelected] = useState<number | null>(7);
  return (
    <BlockSection
      title="MonthDotGrid"
      exportsLine="MonthDotGrid — props: weekdays · weeks (DotGridCell[][]) · selectedDay · onSelectDay (controlled mobile calendar)"
    >
      <p className="text-sm text-muted-foreground">
        The mobile pane calendar: each day shows up to three status dots (red =
        airing, accent = planned, muted = past). A controlled unit — the app
        owns the selected day and pairs it with{" "}
        <code className="font-mono text-xs">DayAgenda</code>. Each day carries
        an <code className="font-mono text-xs">aria-label</code> so the live
        signal is never colour-only.
      </p>
      <SubRow label="Preview">
        <div className="rounded-lg border border-border bg-muted p-8">
          <div className="mx-auto max-w-sm">
            <MonthDotGrid
              weekdays={WEEKDAYS}
              weeks={DOT_WEEKS}
              selectedDay={selected}
              onSelectDay={setSelected}
            />
          </div>
        </div>
      </SubRow>
    </BlockSection>
  );
}

function DayAgendaSection() {
  return (
    <BlockSection
      title="DayAgenda"
      exportsLine="DayAgenda — props: title · rows (DayAgendaRow[]) · emptyText (selected-day event list)"
    >
      <p className="text-sm text-muted-foreground">
        The selected day&apos;s event list below the dot-grid: each row links to
        the event page; a live row takes the red badge + border; an empty day
        shows the app-chosen note.
      </p>
      <SubRow label="State matrix — populated vs empty">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
          <StateCase label="populated" note="rows with one live row">
            <div className="rounded-lg border border-border bg-muted p-8">
              <DayAgenda
                title="7 июля, вторник · сегодня"
                emptyText="В этот день эфиров нет"
                rows={[
                  {
                    href: "#",
                    time: "19:00",
                    school: "Школа кардиологии",
                    title: "Прямой эфир: разбор случаев",
                    live: true,
                    liveLabel: "LIVE",
                  },
                  {
                    href: "#",
                    time: "20:30",
                    school: "Школа терапии",
                    title: "Новое в терапии 2026",
                    liveLabel: "LIVE",
                  },
                ]}
              />
            </div>
          </StateCase>
          <StateCase label="empty" note="no rows — empty note">
            <div className="rounded-lg border border-border bg-muted p-8">
              <DayAgenda
                title="9 июля, четверг"
                rows={[]}
                emptyText="В этот день эфиров нет"
              />
            </div>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

/** A neutral 12-month picker sample exercising every cell variant. */
const PICKER_MONTHS: MonthPickerCell[] = [
  { label: "Янв", note: "прошёл", href: "#", muted: true },
  { label: "Февр", note: "прошёл", href: "#", muted: true },
  { label: "Март", note: "прошёл", href: "#", muted: true },
  { label: "Апр", note: "прошёл", href: "#", muted: true },
  { label: "Май", note: "прошёл", href: "#", muted: true },
  { label: "Июнь", note: "прошёл", href: "#", muted: true },
  { label: "Июль", note: "142 эфира", current: true },
  { label: "Авг", note: "118 эфиров", href: "#" },
  { label: "Сент", note: "156 эфиров", href: "#" },
  { label: "Окт", note: "149 эфиров", href: "#" },
  { label: "Нояб", note: "131 эфир", href: "#" },
  { label: "Дек", note: "87 эфиров", href: "#" },
];

function MonthPickerSection() {
  return (
    <BlockSection
      title="MonthPicker"
      exportsLine="MonthPicker — props: triggerLabel · initialYear · years (MonthPickerYear[]) · prev/nextYearHref (edge fallback) · defaultOpen (native <details> disclosure)"
    >
      <p className="text-sm text-muted-foreground">
        The month view&apos;s chooser: a native{" "}
        <code className="font-mono text-xs">&lt;details&gt;</code> disclosure
        with a year ‹ › stepper and a 3-column grid of the year&apos;s twelve
        months, each with its event count. A past month is muted («прошёл»), the
        displayed month is filled, every other is a link. The year ‹ › stepper
        pages IN PLACE across the app-provided{" "}
        <code className="font-mono text-xs">years</code> window (no navigation,
        popover stays open, counters swap); a step past the window edge follows{" "}
        <code className="font-mono text-xs">prev/nextYearHref</code>. The
        trigger + steppers adopt the{" "}
        <code className="font-mono text-xs">Button</code> outline states. Shown{" "}
        <code className="font-mono text-xs">defaultOpen</code> so the popover is
        catalogued (and a11y-scanned) in place.
      </p>
      <SubRow label="Preview">
        {/*
          The popover is `position: absolute`, so it adds NO height to the canvas: the
          zone has to RESERVE the room. `pb-64` reserved 256px against a ~380px popover
          (header + 4 rows of month cells + padding + the 12px offset), so it painted over
          the next section. `pb-112` (448px) clears it, and `overflow-hidden` frames the
          zone so nothing can bleed outside it if the popover ever grows again.
          Catalogue-level only — the block itself is unchanged.
        */}
        <div className="overflow-hidden rounded-lg border border-border bg-muted p-8 pb-112">
          <MonthPicker
            triggerLabel="Июль 2026"
            pickerLabel="Выбрать месяц"
            initialYear="2026"
            years={[{ year: "2026", months: PICKER_MONTHS }]}
            prevYearHref="#"
            nextYearHref="#"
            prevYearLabel="Предыдущий год"
            nextYearLabel="Следующий год"
            defaultOpen
          />
        </div>
      </SubRow>
    </BlockSection>
  );
}

/* ------------------------------------------------------------------ */
/* Operator block tier (#1578) — DataTable · Pagination · EmptyState     */
/* · FilterBar · Combobox · Form section family                          */
/* ------------------------------------------------------------------ */

/**
 * The demo record set is the REAL taxonomy shape these blocks were built for —
 * medical directions with their long RU names, parent context and counts. A
 * showcase filled with `Row 1` / `slug-a` would catalogue a wireframe, not the unit
 * (#386 unit-as-subject; owner directive 2026-08-27): the two-line record row and
 * the ellipsis rule only prove themselves against a name that genuinely wraps.
 */
type DirectionRow = {
  id: string;
  title: string;
  parent: string;
  code: string;
  specialties: number;
  status: "published" | "draft";
};

const DIRECTION_ROWS: DirectionRow[] = [
  {
    id: "lab",
    title: "Клиническая лабораторная диагностика и лабораторная генетика",
    parent: "Диагностика",
    code: "31.08.05 — клиническая лабораторная диагностика",
    specialties: 14,
    status: "published",
  },
  {
    id: "cvs",
    title: "Сердечно-сосудистая хирургия",
    parent: "Хирургия",
    code: "31.08.63 — сердечно-сосудистая хирургия",
    specialties: 9,
    status: "published",
  },
  {
    id: "func",
    title: "Функциональная диагностика",
    parent: "Диагностика",
    code: "31.08.12 — функциональная диагностика",
    specialties: 6,
    status: "draft",
  },
  {
    id: "obgyn",
    title: "Акушерство и гинекология",
    parent: "Женское здоровье",
    code: "31.08.01 — акушерство и гинекология",
    specialties: 21,
    status: "published",
  },
];

const DIRECTION_RECORD = {
  header: "Направление",
  width: "42%",
  title: (row: DirectionRow) => row.title,
  context: (row: DirectionRow) => row.parent,
  label: (row: DirectionRow) => `Открыть направление «${row.title}»`,
};

/**
 * Status-chip tone per `constitution.md` → DataTable "Token / primitive mapping":
 * status chips reuse the `success-tint` / `warning-tint` / `destructive-tint` +
 * `*-text` pairs, never a raw hex. The semantic fill is also what keeps the chip
 * readable on a hovered row: the `Badge` `label` variant's `bg-tint` is the SAME
 * fill as the row's `hover:bg-tint`, so a default chip dissolves into the row —
 * a semantic tint never collides with it.
 *
 * `Черновик` rides `text-foreground` because the token set has `success-text` and
 * `destructive-text` but NO `warning-text`; `warning-foreground` is the near-black
 * ink for the `warning` FILL and is unreadable on the dark-theme `warning-tint`
 * (#332612), so the theme-flipping `foreground` is the AA-correct pair here. The
 * missing token is recorded in `DEBT.md`.
 */
const DIRECTION_STATUS_CHIP: Record<
  DirectionRow["status"],
  { label: string; className: string }
> = {
  published: {
    label: "Опубликовано",
    className: "bg-success-tint text-success-text",
  },
  draft: { label: "Черновик", className: "bg-warning-tint text-foreground" },
};

const DIRECTION_COLUMNS: DataTableColumn<DirectionRow>[] = [
  {
    key: "code",
    header: "Код номенклатуры",
    width: "28%",
    overflow: "ellipsis",
    render: (row) => row.code,
    fullValue: (row) => row.code,
  },
  {
    key: "specialties",
    header: "Специальностей",
    width: "16%",
    align: "end",
    render: (row) => row.specialties,
  },
  {
    key: "status",
    header: "Статус",
    width: "14%",
    render: (row) => (
      <Badge className={DIRECTION_STATUS_CHIP[row.status].className}>
        {DIRECTION_STATUS_CHIP[row.status].label}
      </Badge>
    ),
  },
];

const DIRECTION_EMPTY_NO_RECORDS = {
  title: "Направлений пока нет",
  description: "Создайте первое направление — специальности привяжутся к нему.",
  action: <Button size="sm">Создать направление</Button>,
};

const DIRECTION_EMPTY_NO_RESULTS = {
  title: "Ничего не найдено",
  description: "По запросу «кардио» и фильтру «Черновики» нет ни одной записи.",
  action: (
    <Button variant="outline" size="sm">
      Сбросить фильтры
    </Button>
  ),
};

const DATA_TABLE_PROPS: PropRow[] = [
  {
    name: "record",
    type: "DataTableRecordColumn of the row type",
    required: true,
    description:
      "Primary two-line record column: title (wraps to 2 lines) + muted context + the row-activation accessible name.",
  },
  {
    name: "columns",
    type: "DataTableColumn of the row type — array",
    required: true,
    description:
      "Declared columns — width · align · overflow · render · fullValue (the reachable full value behind an ellipsis).",
  },
  {
    name: "rows / getRowKey",
    type: "Row[] / (row) => string",
    required: true,
    description: "One server-queried page of rows and their stable keys.",
  },
  {
    name: "caption",
    type: "string",
    required: true,
    description: "Accessible table name — a visually hidden <caption>.",
  },
  {
    name: "rowHref / onRowClick",
    type: "(row) => string / (row) => void",
    required: false,
    description:
      "Single-action list: the whole row opens the record via a real link/button. Omit for inert rows.",
  },
  {
    name: "actions",
    type: "(row) => ReactNode",
    required: false,
    description:
      "Renders a trailing actions column — ONLY for rows with ≥2 actions.",
  },
  {
    name: "isLoading / error",
    type: "boolean / ReactNode",
    required: false,
    description:
      "Skeleton rows under a drawn header; an error node replaces the body (never an empty state).",
  },
  {
    name: "isFiltered",
    type: "boolean",
    required: false,
    description:
      "Routes WHICH empty state shows — no records at all vs no results for the current filter.",
  },
  {
    name: "emptyNoRecords / emptyNoResults",
    type: "EmptyStateProps without variant",
    required: true,
    description: "The two empty situations, never collapsed into one string.",
  },
  {
    name: "pagination",
    type: "PaginationProps",
    required: false,
    description: "Optional paginated footer.",
  },
];

function DataTableSection() {
  return (
    <BlockSection
      title="DataTable"
      exportsLine="DataTable · Table family — props: record · columns · rows · getRowKey · caption · rowHref/onRowClick · actions · isLoading · error · isFiltered · emptyNoRecords/emptyNoResults · pagination"
    >
      <p className="text-sm text-muted-foreground">
        The operator list block: adopted shadcn/ui{" "}
        <code className="font-mono text-xs">Table</code> markup (MIT) re-skinned
        to tokens, wrapped in the owned column contract. Widths are DECLARED so
        a list does not re-lay itself page to page; the record column wraps to
        two lines with a muted context line under it; a long non-title cell
        ellipses and keeps its full value on the native{" "}
        <code className="font-mono text-xs">title</code>. Below{" "}
        <code className="font-mono text-xs">md</code> the grid becomes stacked
        record cards, so a phone never scrolls sideways. A single-action list
        has no «Действия» column — the whole row is the link.
      </p>
      <SubRow label="Preview — populated, whole row opens the record">
        <WideCanvas>
          <DataTable
            caption="Направления"
            record={DIRECTION_RECORD}
            columns={DIRECTION_COLUMNS}
            rows={DIRECTION_ROWS}
            getRowKey={(row) => row.id}
            rowHref={() => "#"}
            emptyNoRecords={DIRECTION_EMPTY_NO_RECORDS}
            emptyNoResults={DIRECTION_EMPTY_NO_RESULTS}
          />
        </WideCanvas>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={DATA_TABLE_PROPS} />
      </SubRow>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase
            label="isLoading"
            note="skeleton rows under an already-drawn header"
          >
            <WideCanvas>
              <DataTable
                caption="Направления"
                record={DIRECTION_RECORD}
                columns={DIRECTION_COLUMNS}
                rows={[]}
                getRowKey={(row) => row.id}
                isLoading
                loadingRowCount={3}
                emptyNoRecords={DIRECTION_EMPTY_NO_RECORDS}
                emptyNoResults={DIRECTION_EMPTY_NO_RESULTS}
              />
            </WideCanvas>
          </StateCase>
          <StateCase
            label="error"
            note="an alert replaces the body — never an empty state"
          >
            <WideCanvas>
              <DataTable
                caption="Направления"
                record={DIRECTION_RECORD}
                columns={DIRECTION_COLUMNS}
                rows={[]}
                getRowKey={(row) => row.id}
                error="Не удалось загрузить направления. Обновите страницу."
                emptyNoRecords={DIRECTION_EMPTY_NO_RECORDS}
                emptyNoResults={DIRECTION_EMPTY_NO_RESULTS}
              />
            </WideCanvas>
          </StateCase>
          <StateCase
            label="rows=[] · isFiltered=false"
            note="no records at all — the create action"
          >
            <WideCanvas>
              <DataTable
                caption="Направления"
                record={DIRECTION_RECORD}
                columns={DIRECTION_COLUMNS}
                rows={[]}
                getRowKey={(row) => row.id}
                emptyNoRecords={DIRECTION_EMPTY_NO_RECORDS}
                emptyNoResults={DIRECTION_EMPTY_NO_RESULTS}
              />
            </WideCanvas>
          </StateCase>
          <StateCase
            label="rows=[] · isFiltered"
            note="no results for the current filter — reset"
          >
            <WideCanvas>
              <DataTable
                caption="Направления"
                record={DIRECTION_RECORD}
                columns={DIRECTION_COLUMNS}
                rows={[]}
                getRowKey={(row) => row.id}
                isFiltered
                emptyNoRecords={DIRECTION_EMPTY_NO_RECORDS}
                emptyNoResults={DIRECTION_EMPTY_NO_RESULTS}
              />
            </WideCanvas>
          </StateCase>
          <StateCase
            label="actions"
            note="a trailing column ONLY when a row has ≥2 actions"
          >
            <WideCanvas>
              <DataTable
                caption="Направления"
                record={DIRECTION_RECORD}
                columns={DIRECTION_COLUMNS}
                rows={DIRECTION_ROWS.slice(0, 2)}
                getRowKey={(row) => row.id}
                actionsHeader="Действия"
                actions={() => (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm">
                      Изменить
                    </Button>
                    <Button variant="outline" size="sm">
                      Снять с публикации
                    </Button>
                  </div>
                )}
                emptyNoRecords={DIRECTION_EMPTY_NO_RECORDS}
                emptyNoResults={DIRECTION_EMPTY_NO_RESULTS}
              />
            </WideCanvas>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

const PAGINATION_PROPS: PropRow[] = [
  {
    name: "page / pageCount",
    type: "number",
    required: true,
    description:
      "Current 1-based page and the total. A pageCount ≤ 1 renders nothing at all.",
  },
  {
    name: "onPageChange",
    type: "(page: number) => void",
    required: true,
    description: "Page request — the surface re-queries.",
  },
  {
    name: "navLabel",
    type: "string",
    required: true,
    description: "Accessible name of the <nav> landmark («Страницы»).",
  },
  {
    name: "previousLabel / nextLabel",
    type: "string",
    required: true,
    description: "Visible previous/next copy — app-supplied, localized.",
  },
  {
    name: "pageLabel",
    type: "(page: number) => string",
    required: true,
    description: "Per-number accessible label builder.",
  },
  {
    name: "readout",
    type: "ReactNode",
    required: false,
    description: "Range readout («Показаны 21–40 из 137»).",
  },
  {
    name: "isLoading",
    type: "boolean",
    required: false,
    description: "Controls are inert while the next page is in flight.",
  },
  {
    name: "siblingCount",
    type: "number",
    required: false,
    description: "Pages rendered either side of the current one.",
  },
];

function PaginationSection() {
  const [page, setPage] = useState(4);
  return (
    <BlockSection
      title="Pagination"
      exportsLine="Pagination · buildPageItems — props: page · pageCount · onPageChange · navLabel · previousLabel/nextLabel · pageLabel · readout · isLoading · siblingCount"
    >
      <p className="text-sm text-muted-foreground">
        Numbered pages (owner pick П1): an operator who knows a record sits
        «somewhere near the end» jumps there instead of pressing «дальше» nine
        times. The GOV.UK rules are enforced by the block, not by each call site
        — nothing renders for a single page, «Назад» is absent on page 1 and
        «Вперёд» on the last, and exactly one number carries{" "}
        <code className="font-mono text-xs">aria-current=&quot;page&quot;</code>
        . Live sample — the numbers below actually page.
      </p>
      <SubRow label="Preview">
        <Canvas>
          <Pagination
            page={page}
            pageCount={12}
            onPageChange={setPage}
            navLabel="Страницы"
            previousLabel="Назад"
            nextLabel="Вперёд"
            pageLabel={(n) => `Страница ${n}`}
            readout={`Показаны ${(page - 1) * 20 + 1}–${Math.min(page * 20, 231)} из 231`}
          />
        </Canvas>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={PAGINATION_PROPS} />
      </SubRow>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase label="page=1" note="no «Назад» on the first page">
            <Canvas>
              <Pagination
                page={1}
                pageCount={12}
                onPageChange={() => {}}
                navLabel="Страницы"
                previousLabel="Назад"
                nextLabel="Вперёд"
                pageLabel={(n) => `Страница ${n}`}
              />
            </Canvas>
          </StateCase>
          <StateCase label="page=pageCount" note="no «Вперёд» on the last page">
            <Canvas>
              <Pagination
                page={12}
                pageCount={12}
                onPageChange={() => {}}
                navLabel="Страницы"
                previousLabel="Назад"
                nextLabel="Вперёд"
                pageLabel={(n) => `Страница ${n}`}
              />
            </Canvas>
          </StateCase>
          <StateCase
            label="isLoading"
            note="inert while the next page is in flight"
          >
            <Canvas>
              <Pagination
                page={4}
                pageCount={12}
                onPageChange={() => {}}
                navLabel="Страницы"
                previousLabel="Назад"
                nextLabel="Вперёд"
                pageLabel={(n) => `Страница ${n}`}
                isLoading
              />
            </Canvas>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

const EMPTY_STATE_PROPS: PropRow[] = [
  {
    name: "variant",
    type: '"no-records" | "no-results"',
    required: true,
    description:
      "WHICH empty situation this is — the two are never one string.",
  },
  {
    name: "title",
    type: "ReactNode",
    required: true,
    description: "Heading, app-supplied and localized.",
  },
  {
    name: "description",
    type: "ReactNode",
    required: false,
    description: "One explanatory line; for no-results, name what was applied.",
  },
  {
    name: "action",
    type: "ReactNode",
    required: false,
    description:
      "At most one action — create for no-records, reset filters for no-results.",
  },
];

function EmptyStateSection() {
  return (
    <BlockSection
      title="EmptyState"
      exportsLine="EmptyState — props: variant (no-records | no-results) · title · description · action"
    >
      <p className="text-sm text-muted-foreground">
        Two different situations, two different states. «Ничего не создано»
        invites the operator to create the first record; «ничего не найдено по
        фильтру» must instead name what was applied and offer the way back.
        Collapsing both into one «Нет данных» is the defect this block exists to
        prevent — the operator cannot tell an empty catalogue from a too-narrow
        filter.
      </p>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase
            label='variant="no-records"'
            note="the catalogue is genuinely empty"
          >
            <Canvas>
              <EmptyState
                variant="no-records"
                {...DIRECTION_EMPTY_NO_RECORDS}
              />
            </Canvas>
          </StateCase>
          <StateCase
            label='variant="no-results"'
            note="the filter is too narrow — name it, offer the way back"
          >
            <Canvas>
              <EmptyState
                variant="no-results"
                {...DIRECTION_EMPTY_NO_RESULTS}
              />
            </Canvas>
          </StateCase>
        </div>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={EMPTY_STATE_PROPS} />
      </SubRow>
    </BlockSection>
  );
}

const EVENT_LIST_PROPS: PropRow[] = [
  {
    name: "items",
    type: "EventListItem[]",
    required: true,
    description:
      "Host-projected event cards, already ordered and grouped; the block performs no fetch.",
  },
  {
    name: "selectedTab",
    type: '"upcoming" | "past"',
    required: true,
    description: "Controlled membership state owned by the host router.",
  },
  {
    name: "onTabChange",
    type: "(tab) => void",
    required: true,
    description: "Host callback for URL/router synchronization.",
  },
  {
    name: "counts",
    type: "Record<EventListTab, number>",
    required: true,
    description: "Server-projected totals displayed in the two tabs.",
  },
  {
    name: "labels",
    type: "EventListLabels",
    required: true,
    description: "Host-owned copy for tabs, empty state, and pagination.",
  },
  {
    name: "page / pageCount",
    type: "number",
    required: true,
    description: "Controlled pagination position and bounded page count.",
  },
  {
    name: "onPageChange",
    type: "(page, cursor?) => void",
    required: true,
    description:
      "Host callback; network and cursor ownership remain outside the block.",
  },
  {
    name: "toolbar",
    type: "ReactNode",
    required: false,
    description: "Optional host controls between the tabs and grouped feed.",
  },
];

const EVENT_LIST_LABELS = {
  upcoming: "Schedule",
  past: "Recording archive",
  emptyTitle: "No events yet",
  emptyDescription: "New sessions will appear here after publication.",
  pagination: "Event pages",
  previous: "Previous",
  next: "Next",
  page: (page: number) => `Page ${page}`,
};

const EVENT_LIST_BASE_ITEM = {
  id: "clinical-cases",
  groupKey: "2026-08",
  groupLabel: "August 2026",
  href: "/webinars/clinical-cases",
  time: "18:00",
  tzLabel: "MSK",
  dateLabel: "30 August · Sun",
  school: "School of cardiology",
  title: "Clinical cases in daily practice",
  specialties: ["Cardiology", "Therapy"],
  speakers: [{ name: "Dr Marina Volkova", affiliation: "University clinic" }],
  recordingLabel: "Recording is available",
};

function EventListSection() {
  const [selectedTab, setSelectedTab] = useState<EventListTab>("upcoming");
  const items =
    selectedTab === "past"
      ? [
          {
            ...EVENT_LIST_BASE_ITEM,
            variant: "past" as const,
            ctaHref: EVENT_LIST_BASE_ITEM.href,
            ctaLabel: "Watch recording ↗",
          },
        ]
      : [
          {
            ...EVENT_LIST_BASE_ITEM,
            groupKey: "2026-08-30",
            groupLabel: "30 August, Sunday",
            recordingLabel: undefined,
          },
        ];

  return (
    <BlockSection
      title="Event list"
      exportsLine="EventList · EventListItem · EventListTab"
    >
      <SubRow label="Preview">
        <WideCanvas>
          <div
            className="mx-auto w-full max-w-5xl"
            data-testid="event-list-showcase"
          >
            <EventList
              items={items}
              selectedTab={selectedTab}
              onTabChange={setSelectedTab}
              counts={{ upcoming: 2, past: 1 }}
              labels={EVENT_LIST_LABELS}
              page={1}
              pageCount={1}
              onPageChange={() => {}}
            />
          </div>
        </WideCanvas>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={EVENT_LIST_PROPS} />
      </SubRow>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase
            label="controlled · filled"
            note="tab and page state are supplied by the host; switching performs no network request"
          >
            <span className="text-sm text-muted-foreground">
              The live preview above switches between the schedule and recording
              archive.
            </span>
          </StateCase>
          <StateCase
            label="controlled · empty"
            note="the host supplies an empty projection and translated recovery copy"
          >
            <EventList
              items={[]}
              selectedTab="past"
              onTabChange={() => {}}
              counts={{ upcoming: 0, past: 0 }}
              labels={EVENT_LIST_LABELS}
              page={1}
              pageCount={1}
              onPageChange={() => {}}
            />
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

const FILTER_BAR_PROPS: PropRow[] = [
  {
    name: "applyMode",
    type: '"instant" | "batch"',
    required: true,
    description:
      "REQUIRED, whole-bar — a surface cannot mix apply models by accident.",
  },
  {
    name: "label",
    type: "string",
    required: true,
    description: "Accessible name of the toolbar region.",
  },
  {
    name: "search",
    type: "{ value · onCommit · label · placeholder · debounceMs }",
    required: false,
    description:
      "Free-text search — debounced (~400ms) in instant, submit-gated in batch.",
  },
  {
    name: "children",
    type: "ReactNode",
    required: false,
    description: "Facet controls — NativeSelect, FilterChip, Switch, Combobox.",
  },
  {
    name: "applied / appliedLabel",
    type: "AppliedFilter[] / string",
    required: false,
    description: "Everything currently applied, as removable FilterChips.",
  },
  {
    name: "removeFilterLabel",
    type: "string",
    required: false,
    description:
      "Verb prefix for a chip's remove control («Убрать фильтр: Черновики»).",
  },
  {
    name: "onResetAll / resetLabel",
    type: "() => void / string",
    required: false,
    description: "«Сбросить всё» — visible only while something is applied.",
  },
  {
    name: "resultCount",
    type: "ReactNode",
    required: false,
    description: "Result count line, announced politely (role=status).",
  },
  {
    name: "isBusy / busyLabel",
    type: "boolean / string",
    required: false,
    description:
      "A query is in flight — the field carries the busy cue, never a frozen list.",
  },
];

/**
 * The live preview filters a REAL book, not a hardcoded pair of numbers: the readout
 * «Найдено N из M» has to move when the operator types or drops a chip, otherwise the
 * preview demonstrates the opposite of the block's contract.
 */
type FilterFacet = {
  id: string;
  label: string;
  matches: (row: DirectionBookRow) => boolean;
};
type DirectionBookRow = {
  title: string;
  parent: string;
  status: "published" | "draft";
};

const DIRECTION_BOOK: DirectionBookRow[] = [
  ...DIRECTION_ROWS.map(({ title, parent, status }) => ({
    title,
    parent,
    status,
  })),
  {
    title: "Ультразвуковая диагностика",
    parent: "Диагностика",
    status: "draft",
  },
  { title: "Рентгенология", parent: "Диагностика", status: "published" },
  { title: "Кардиология", parent: "Терапия", status: "published" },
  { title: "Детская кардиология", parent: "Педиатрия", status: "draft" },
  { title: "Эндокринология", parent: "Терапия", status: "published" },
  { title: "Неонатология", parent: "Педиатрия", status: "published" },
  { title: "Травматология и ортопедия", parent: "Хирургия", status: "draft" },
  {
    title: "Анестезиология и реаниматология",
    parent: "Хирургия",
    status: "published",
  },
];

const DIRECTION_FACETS: FilterFacet[] = [
  { id: "draft", label: "Черновики", matches: (row) => row.status === "draft" },
  {
    id: "diagnostics",
    label: "Диагностика",
    matches: (row) => row.parent === "Диагностика",
  },
];

function FilterBarSection() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState<string[]>(["draft", "diagnostics"]);
  const facets = DIRECTION_FACETS.filter((facet) => applied.includes(facet.id));
  const needle = query.trim().toLocaleLowerCase();
  const found = DIRECTION_BOOK.filter(
    (row) =>
      (needle === "" || row.title.toLocaleLowerCase().includes(needle)) &&
      facets.every((facet) => facet.matches(row)),
  );
  return (
    <BlockSection
      title="FilterBar"
      exportsLine="FilterBar — props: applyMode · label · search · children · applied/appliedLabel · removeFilterLabel · onResetAll/resetLabel · resultCount · isBusy/busyLabel · submitLabel/onSubmit (batch only)"
    >
      <p className="text-sm text-muted-foreground">
        Instant apply (owner pick): typing narrows the list after a ~400ms pause
        with a busy cue in the field itself — no «Применить» button to forget.
        Every applied value comes back as a removable chip (the{" "}
        <code className="font-mono text-xs">FilterChip</code> primitive) so the
        operator always sees WHY the list is short, and «Сбросить всё» appears
        only while something is applied.{" "}
        <code className="font-mono text-xs">applyMode</code> is required and
        whole-bar: a bar where the text field applies instantly but the facets
        wait for a button is untypeable here by construction.
      </p>
      <SubRow label='Preview — applyMode="instant", live'>
        <div className="w-full rounded-lg border border-border bg-muted p-8">
          <FilterBar
            applyMode="instant"
            label="Фильтры направлений"
            search={{
              value: query,
              onCommit: setQuery,
              label: "Поиск по названию",
              placeholder: "Например, кардиология",
            }}
            applied={facets.map((facet) => ({
              id: facet.id,
              label: facet.label,
              onRemove: () =>
                setApplied((prev) => prev.filter((item) => item !== facet.id)),
            }))}
            appliedLabel="Выбрано:"
            removeFilterLabel="Убрать фильтр"
            onResetAll={() => {
              setApplied([]);
              setQuery("");
            }}
            resetLabel="Сбросить всё"
            resultCount={`Найдено ${found.length} из ${DIRECTION_BOOK.length}`}
            busyLabel="Идёт поиск"
          />
          <ul className="mt-4 flex flex-col gap-1 text-sm text-foreground">
            {found.map((row) => (
              <li key={row.title}>
                {row.title}
                <span className="text-muted-foreground">
                  {" · "}
                  {row.parent}
                  {row.status === "draft" ? " · черновик" : ""}
                </span>
              </li>
            ))}
            {found.length === 0 ? (
              <li className="text-muted-foreground">Ничего не найдено</li>
            ) : null}
          </ul>
        </div>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={FILTER_BAR_PROPS} />
      </SubRow>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase
            label="nothing applied"
            note="no chips row, no «Сбросить всё»"
          >
            <div className="w-full rounded-lg border border-border bg-muted p-8">
              <FilterBar
                applyMode="instant"
                label="Фильтры направлений"
                search={{
                  value: "",
                  onCommit: () => {},
                  label: "Поиск по названию",
                  placeholder: "Например, кардиология",
                }}
                resetLabel="Сбросить всё"
                resultCount="Найдено 231 из 231"
              />
            </div>
          </StateCase>
          <StateCase
            label="isBusy"
            note="busy cue in the field — the list is not frozen"
          >
            <div className="w-full rounded-lg border border-border bg-muted p-8">
              <FilterBar
                applyMode="instant"
                label="Фильтры направлений"
                search={{
                  value: "кардио",
                  onCommit: () => {},
                  label: "Поиск по названию",
                }}
                resetLabel="Сбросить всё"
                isBusy
                busyLabel="Идёт поиск"
                resultCount="Найдено 12 из 231"
              />
            </div>
          </StateCase>
          <StateCase
            label='applyMode="batch"'
            note="submit-gated — for a bar whose query is expensive"
          >
            <div className="w-full rounded-lg border border-border bg-muted p-8">
              <FilterBar
                applyMode="batch"
                label="Фильтры отчёта"
                search={{
                  value: "",
                  onCommit: () => {},
                  label: "Поиск по названию",
                }}
                resetLabel="Сбросить всё"
                submitLabel="Показать"
                onSubmit={() => {}}
              />
            </div>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

/** «Вид связи» — five options where the LABEL alone does not settle the meaning. */
const LINK_KINDS: ComboboxOption[] = [
  {
    value: "adjacent_area",
    label: "Смежная область",
    description: "Направления пересекаются, но ни одно не входит в другое",
  },
  {
    value: "narrower",
    label: "Более узкое направление",
    description: "Частный случай выбранного направления",
  },
  {
    value: "broader",
    label: "Более широкое направление",
    description: "Выбранное направление входит в это",
  },
  {
    value: "diagnostic_support",
    label: "Диагностическая поддержка",
    description: "Помогает ставить диагноз в выбранном направлении",
  },
  {
    value: "shared_disease_group",
    label: "Общая группа заболеваний",
    description: "Работают с одной группой заболеваний",
  },
];

/** A long closed book — the case that earns the in-panel query box. */
const SPECIALTY_BOOK: ComboboxOption[] = [
  { value: "cardiology", label: "Кардиология" },
  { value: "cardiovascular_surgery", label: "Сердечно-сосудистая хирургия" },
  { value: "endocrinology", label: "Эндокринология" },
  { value: "pediatric_endocrinology", label: "Детская эндокринология" },
  { value: "gastroenterology", label: "Гастроэнтерология" },
  { value: "neurology", label: "Неврология" },
  { value: "neurosurgery", label: "Нейрохирургия" },
  { value: "oncology", label: "Онкология" },
  { value: "hematology", label: "Гематология" },
  { value: "rheumatology", label: "Ревматология" },
  { value: "nephrology", label: "Нефрология" },
  { value: "urology", label: "Урология" },
  { value: "pulmonology", label: "Пульмонология" },
  { value: "allergology", label: "Аллергология и иммунология" },
  { value: "dermatovenerology", label: "Дерматовенерология" },
  { value: "ophthalmology", label: "Офтальмология" },
  { value: "otorhinolaryngology", label: "Оториноларингология" },
  { value: "psychiatry", label: "Психиатрия" },
  { value: "anesthesiology", label: "Анестезиология-реаниматология" },
  {
    value: "clinical_lab_diagnostics",
    label: "Клиническая лабораторная диагностика",
  },
];

const COMBOBOX_PROPS: PropRow[] = [
  {
    name: "options",
    type: "ComboboxOption[]",
    required: true,
    description:
      "value (stored, never rendered) · label (read + searched) · description (the explanation line) · disabled.",
  },
  {
    name: "value / onValueChange",
    type: "string | null / (value: string) => void",
    required: true,
    description:
      "Commit is only ever called with a value FROM options — typing never enters free text.",
  },
  {
    name: "placeholder",
    type: "string",
    required: true,
    description: "Control copy while empty.",
  },
  {
    name: "emptyLabel",
    type: "string",
    required: true,
    description: "The no-match line («Ничего не найдено»).",
  },
  {
    name: "searchLabel / searchPlaceholder",
    type: "string",
    required: false,
    description: "Accessible name + placeholder for the in-panel query box.",
  },
  {
    name: "showSearch",
    type: "boolean",
    required: false,
    description:
      "Defaults ON above 12 options, OFF for a short explained vocabulary.",
  },
  {
    name: "countLabel",
    type: "(shown, total) => string",
    required: false,
    description: "«Найдено N из M» counter under the list.",
  },
  {
    name: "invalid / disabled",
    type: "boolean",
    required: false,
    description:
      "Both live on the control itself, matching the NativeSelect geometry.",
  },
];

function ComboboxSection() {
  const [kind, setKind] = useState<string | null>("narrower");
  const [specialty, setSpecialty] = useState<string | null>(null);
  return (
    <BlockSection
      title="Combobox"
      exportsLine="Combobox — props: options (value · label · description) · value/onValueChange · placeholder · emptyLabel · searchLabel/searchPlaceholder · showSearch · countLabel · invalid/disabled"
    >
      <p className="text-sm text-muted-foreground">
        Adopted from Kibo UI (MIT — Radix Popover + cmdk) and re-skinned to the{" "}
        <code className="font-mono text-xs">NativeSelect</code> geometry, so the
        two read as one control family. It exists for the case a native select
        cannot serve: a CLOSED vocabulary whose options need an explanation line
        each, or a book too long to scan without a query box. The vocabulary
        stays closed — typing filters, it never commits free text — and the
        stored slug is never shown to the operator.
      </p>
      <SubRow label="Preview — explained vocabulary (no query box), live">
        <div className="w-full max-w-md rounded-lg border border-border bg-muted p-8">
          <Combobox
            options={LINK_KINDS}
            value={kind}
            onValueChange={setKind}
            placeholder="Выберите вид связи"
            emptyLabel="Ничего не найдено"
          />
        </div>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={COMBOBOX_PROPS} />
      </SubRow>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase
            label="long book"
            note="query box + counter appear above 12 options"
          >
            <div className="w-full max-w-md rounded-lg border border-border bg-muted p-8">
              <Combobox
                options={SPECIALTY_BOOK}
                value={specialty}
                onValueChange={setSpecialty}
                placeholder="Выберите специальность"
                searchLabel="Поиск по справочнику"
                searchPlaceholder="Начните вводить название"
                emptyLabel="Ничего не найдено"
                countLabel={(shownCount, total) =>
                  `Найдено ${shownCount} из ${total}`
                }
              />
            </div>
          </StateCase>
          <StateCase
            label="invalid"
            note="the invalid state lives on the control itself"
          >
            <div className="w-full max-w-md rounded-lg border border-border bg-muted p-8">
              <Combobox
                options={LINK_KINDS}
                onValueChange={() => {}}
                placeholder="Выберите вид связи"
                emptyLabel="Ничего не найдено"
                invalid
              />
            </div>
          </StateCase>
          <StateCase label="disabled" note="not editable on this record">
            <div className="w-full max-w-md rounded-lg border border-border bg-muted p-8">
              <Combobox
                options={LINK_KINDS}
                value="broader"
                onValueChange={() => {}}
                placeholder="Выберите вид связи"
                emptyLabel="Ничего не найдено"
                disabled
              />
            </div>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

const FORM_SECTION_PROPS: PropRow[] = [
  {
    name: "FormSection legend",
    type: "ReactNode",
    required: true,
    description:
      "The section's statement heading — a real <legend> inside a real <fieldset>.",
  },
  {
    name: "FormSection description",
    type: "ReactNode",
    required: false,
    description:
      "One line of section context — the place for what would bloat a field hint.",
  },
  {
    name: "FormSection locked",
    type: "boolean",
    required: false,
    description:
      "A section the server refuses to change (e.g. after first publication).",
  },
  {
    name: "FormFieldGroup columns",
    type: '"one" | "two"',
    required: false,
    description:
      "Two-up row for genuinely paired short fields; collapses below sm.",
  },
  {
    name: "FormSeparator",
    type: "—",
    required: false,
    description: "The rule between sections of one fieldset.",
  },
  {
    name: "FormActions secondary",
    type: "ReactNode",
    required: false,
    description:
      "Cancel / secondary node, after the primary at low prominence.",
  },
  {
    name: "FormDerivedNote title",
    type: "ReactNode",
    required: true,
    description:
      "Names a value the system derives (e.g. «Адрес страницы») and when it locks.",
  },
];

function FormSectionShowcase() {
  return (
    <BlockSection
      title="Form section family"
      exportsLine="FormSection · FormFieldGroup · FormSeparator · FormActions · FormDerivedNote — the shadcn Field family (MIT), composed with the existing form primitive"
    >
      <p className="text-sm text-muted-foreground">
        «Ruled sections»: a long record form is broken into real{" "}
        <code className="font-mono text-xs">&lt;fieldset&gt;</code>/
        <code className="font-mono text-xs">&lt;legend&gt;</code> groups with a
        rule between them, so an operator scanning for one field lands in the
        right group instead of reading a wall of inputs. Semantics come first:
        assistive tech announces the group name with every field inside it.{" "}
        <code className="font-mono text-xs">FormDerivedNote</code> covers the
        recurring admin case of a value the system computes — the operator is
        told what it will be and when it stops changing, instead of finding out
        after saving.
      </p>
      <SubRow label="Preview">
        <div className="w-full max-w-2xl rounded-lg border border-border bg-muted p-8">
          <form
            className="flex flex-col gap-6"
            onSubmit={(e) => e.preventDefault()}
          >
            <FormSection
              legend="Основное"
              description="Как направление называется в каталоге и в поиске."
            >
              <FormFieldGroup>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="direction-title">Название направления</Label>
                  <Input
                    id="direction-title"
                    defaultValue="Клиническая лабораторная диагностика"
                  />
                </div>
              </FormFieldGroup>
              <FormFieldGroup columns="two">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="direction-code">Код номенклатуры</Label>
                  <Input id="direction-code" defaultValue="31.08.05" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="direction-parent">
                    Родительское направление
                  </Label>
                  <NativeSelect
                    id="direction-parent"
                    defaultValue="diagnostics"
                  >
                    <option value="diagnostics">Диагностика</option>
                    <option value="surgery">Хирургия</option>
                    <option value="womens-health">Женское здоровье</option>
                  </NativeSelect>
                </div>
              </FormFieldGroup>
              <FormDerivedNote title="Адрес страницы">
                academy.doctor.school/napravleniya/klinicheskaya-laboratornaya-diagnostika
                — адрес перестанет меняться после первой публикации.
              </FormDerivedNote>
            </FormSection>
            <FormSeparator />
            <FormSection
              legend="Публикация"
              description="Где направление показывается врачу."
            >
              <FormFieldGroup>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="direction-status">Статус</Label>
                  <NativeSelect id="direction-status" defaultValue="draft">
                    <option value="draft">Черновик</option>
                    <option value="published">Опубликовано</option>
                  </NativeSelect>
                </div>
              </FormFieldGroup>
            </FormSection>
            <FormActions secondary={<Button variant="outline">Отмена</Button>}>
              <Button type="submit">Сохранить</Button>
            </FormActions>
          </form>
        </div>
      </SubRow>
      <SubRow label="Slots / props">
        <PropsTable rows={FORM_SECTION_PROPS} />
      </SubRow>
      <SubRow label="State matrix">
        <div className="grid gap-6">
          <StateCase
            label="locked"
            note="the server refuses to change this section — say so, don't hide it"
          >
            <div className="w-full max-w-2xl rounded-lg border border-border bg-muted p-8">
              <FormSection
                legend="Адрес страницы"
                description="Зафиксирован после первой публикации — старые ссылки не должны ломаться."
                locked
              >
                <FormFieldGroup>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="direction-slug">Адрес</Label>
                    <Input
                      id="direction-slug"
                      defaultValue="klinicheskaya-laboratornaya-diagnostika"
                      disabled
                    />
                  </div>
                </FormFieldGroup>
              </FormSection>
            </div>
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
      <MonthCalendarGridSection />
      <MonthDotGridSection />
      <DayAgendaSection />
      <MonthPickerSection />
      <DataTableSection />
      <PaginationSection />
      <EmptyStateSection />
      <EventListSection />
      <FilterBarSection />
      <ComboboxSection />
      <FormSectionShowcase />
    </div>
  );
}
