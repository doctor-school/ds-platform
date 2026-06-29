"use client";

import { type ReactNode } from "react";
import { useForm, type FieldValues } from "react-hook-form";

import { Form, FormField } from "@ds/design-system/form";
import {
  AuthCard,
  AuthLayout,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";

/**
 * Blocks section (design-system-showcase spec §3.3). Each exported
 * `@ds/design-system` block — `AuthCard`, `AuthLayout`, `OtpFocusScreen` — is
 * catalogued the SAME unit-as-subject way as Tokens (§3.1) and Primitives (§3.2):
 * the subject is the block's **composition contract** — its slots / props and the
 * **state matrix a consumer must handle** — NOT a re-staged finished product screen
 * (the inversion caught post-merge on #348 → this rework #386).
 *
 * So every slot is filled with a labelled, app-supplied placeholder that EXPOSES the
 * slot (a dashed region named for the prop it stands in for), never marketing copy or
 * a brand wordmark dressing the block as the login/verify surface it composes into.
 * The blocks themselves still render through their REAL composed primitives (Card,
 * OtpField, Button…) branded by their own tokens — the `AuthLayout` brand panel paints
 * from the semantic `primary-surface` token — and the showcase re-implements nothing
 * (spec §2.4); the placeholders are catalogue chrome standing in for the app layer.
 */

/** Section frame — mirrors the primitives view so all three sections read identically. */
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

/** A labelled sub-row inside a section (the slot-anatomy row, a state-matrix row).
 *  Mirrors the primitives view's `SubRow`. */
function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Inline slot marker — a dashed mono chip naming a slot, used where the slot sits
 * inline inside the block (the `AuthCard` `icon` / `title` / `description`, the
 * `AuthLayout` `logo`). It stands in for the app-supplied node and names it, instead
 * of pretending to be product copy. `onPanel` recolours it for the branded panel.
 */
function SlotTag({ name, onPanel = false }: { name: string; onPanel?: boolean }) {
  return (
    <span
      className={`inline-flex rounded border border-dashed px-1.5 py-0.5 font-mono text-xs ${
        onPanel
          ? "border-primary-foreground/50 text-primary-foreground"
          : "border-border text-muted-foreground"
      }`}
    >
      {name}
    </span>
  );
}

/**
 * Block-level slot region — a labelled dashed box exposing a slot the app fills (the
 * `AuthCard` `children`, the `AuthLayout` `aside`). The mono label names the slot; the
 * optional note describes what the consumer passes. `onPanel` recolours it for the
 * `primary-surface` brand panel.
 */
function Slot({
  name,
  note,
  onPanel = false,
}: {
  name: string;
  note?: string;
  onPanel?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border border-dashed p-3 ${
        onPanel ? "border-primary-foreground/50" : "border-border"
      }`}
    >
      <span
        className={`font-mono text-xs ${
          onPanel ? "text-primary-foreground" : "text-muted-foreground"
        }`}
      >
        {name}
      </span>
      {note ? (
        <span
          className={`text-xs ${
            onPanel ? "text-primary-foreground/80" : "text-muted-foreground/70"
          }`}
        >
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** A labelled state-matrix cell — the state name (+ the prop that drives it) above
 *  its rendered sample. */
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
          <span className="text-xs text-muted-foreground/70">{note}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function AuthCardSection() {
  return (
    <BlockSection
      title="AuthCard"
      exportsLine="AuthCard — slots: icon? · title · description? · children · footer? (token-only Card scaffold)"
    >
      <p className="text-sm text-muted-foreground">
        The owned presentation scaffold the four auth surfaces (login / register /
        reset / verify) compose into. It renders the real{" "}
        <code className="font-mono text-xs">Card</code> primitives; every slot below
        is app-supplied — the block carries no copy, form, or icon of its own.
      </p>

      <SubRow label="Slot anatomy — every slot exposed">
        <AuthCard
          className="max-w-md"
          icon={<SlotTag name="icon" />}
          title={<SlotTag name="title" />}
          description={<SlotTag name="description" />}
          footer={<SlotTag name="footer" />}
        >
          <Slot
            name="children"
            note="app-owned form / body — composes any primitives"
          />
        </AuthCard>
      </SubRow>

      <SubRow label="State matrix — optional-slot presence">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
          <StateCase label="all slots" note="icon + description + footer present">
            <AuthCard
              className="max-w-md"
              icon={<SlotTag name="icon" />}
              title={<SlotTag name="title" />}
              description={<SlotTag name="description" />}
              footer={<SlotTag name="footer" />}
            >
              <Slot name="children" />
            </AuthCard>
          </StateCase>
          <StateCase
            label="required only"
            note="title + children; icon / description / footer omitted"
          >
            <AuthCard className="max-w-md" title={<SlotTag name="title" />}>
              <Slot name="children" />
            </AuthCard>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

/** A compact `AuthCard` with its slots exposed, nested into the `AuthLayout` demos as
 *  the `children` the layout wraps (the layout's real contract is "wraps an AuthCard"). */
function NestedAuthCard() {
  return (
    <AuthCard
      icon={<SlotTag name="icon" />}
      title={<SlotTag name="title" />}
      description={<SlotTag name="description" />}
      footer={<SlotTag name="footer" />}
    >
      <Slot name="children" note="app-owned form" />
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
        <code className="font-mono text-xs">AuthCard</code>. The brand panel paints
        from the semantic{" "}
        <code className="font-mono text-xs">primary-surface</code> token (the block's
        own branding); the <code className="font-mono text-xs">logo</code> and the
        panel <code className="font-mono text-xs">aside</code> are app-supplied. The
        two-column split appears at{" "}
        <code className="font-mono text-xs">lg+</code>; the block's{" "}
        <code className="font-mono text-xs">min-h-screen</code> is neutralised to{" "}
        <code className="font-mono text-xs">min-h-0</code> here so it sizes to content
        at catalogue scale.
      </p>

      <SubRow label="State matrix — aside present vs omitted">
        <div className="flex flex-col gap-6">
          <StateCase
            label="aside present"
            note="branded split — brand panel (lg+) + form column"
          >
            <div className="overflow-hidden rounded-xl border border-border">
              <AuthLayout
                className="min-h-0"
                logo={<SlotTag name="logo" />}
                aside={
                  <Slot
                    name="aside"
                    note="app-supplied brand-panel headline / sub-copy / art"
                    onPanel
                  />
                }
              >
                <NestedAuthCard />
              </AuthLayout>
            </div>
          </StateCase>

          <StateCase
            label="aside omitted"
            note="form-only — logo on every breakpoint, panel not rendered"
          >
            <div className="overflow-hidden rounded-xl border border-border">
              <AuthLayout className="min-h-0" logo={<SlotTag name="logo" />}>
                <NestedAuthCard />
              </AuthLayout>
            </div>
          </StateCase>
        </div>
      </SubRow>
    </BlockSection>
  );
}

/**
 * `OtpFocusScreen` demo wrapper. The block takes an RHF `field` (the app owns the
 * form), so each sample mounts its own `<Form>` + `<FormField>` to supply a real
 * `code` field. Every visible string is passed by PROP NAME (`submitLabel`,
 * `resendLabel`, …) so the sample exposes the copy contract instead of reading as a
 * finished verify screen; the masked destination demonstrates the real
 * `maskDestination` export. Handlers are no-op `preventDefault` (pure viewer).
 * `cooldownSeconds` / `isSubmitting` / `error` drive the state shown.
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
            title="title"
            sentToLabel={`sentToLabel · ${maskDestination("doctor@example.com")}`}
            codeLabel="codeLabel"
            submitLabel="submitLabel"
            resendLabel="resendLabel"
            resendCountdownLabel={(seconds) => `resendCountdownLabel(${seconds})`}
            changeMethodLabel="changeMethodLabel"
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

/** Catalogue frame for an `OtpFocusScreen` sample — the surface composes it inside a
 *  card region, so each state renders in a bordered box at catalogue scale. */
function OtpFrame({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-sm rounded-xl border border-border p-6">{children}</div>
  );
}

function OtpFocusScreenSection() {
  return (
    <BlockSection
      title="OtpFocusScreen"
      exportsLine="OtpFocusScreen — props: field · length · sentToLabel · *Label copy · cooldownSeconds · resendNonce · isSubmitting · error"
    >
      <p className="text-sm text-muted-foreground">
        The focused OTP-entry block a surface swaps in once a code is issued: by
        construction it renders ONLY masked destination + code input + submit +
        resend(cooldown) + change-method, so the user cannot wander off the challenge.
        Every visible string is an app-supplied prop (labelled here by prop name); the
        masked destination is computed by the app via{" "}
        <code className="font-mono text-xs">maskDestination</code>. The subject is the{" "}
        <strong className="font-medium text-foreground">
          state matrix a consumer must drive
        </strong>
        .
      </p>
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
              <OtpFocusDemo cooldownSeconds={30} error="error slot (mapped message)" />
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
