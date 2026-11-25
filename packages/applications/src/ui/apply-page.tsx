import type { ReactNode } from "react";

import { Link } from "@ds/design-system/link";

import { applicationsCopy as copy } from "../copy";
import { AccountGate, type AccountGateHost } from "./account-gate";
import {
  AuthorApplication,
  type AuthorApplicationHost,
  type ApplyViewer,
} from "./author-application";

export interface ApplyPageProps {
  /** The signed-in account, or `null` for a guest (EARS-3). */
  viewer: ApplyViewer | null;
  /** The Academy home — the breadcrumb's first step. */
  homeHref: string;
  gate: AccountGateHost;
  form: AuthorApplicationHost;
  /** The bot-protection notice the route renders under the form (EARS-7). */
  disclosure?: ReactNode;
}

/**
 * 033 EARS-1 — «Подать заявку» (`academy.doctor.school/apply`), built from the
 * owner's Stage A canvas `design-source/academy-apply.dc.html` at `scope` =
 * «срез 1»: the poster header, the form area (the account gate of EARS-3 for a
 * guest, the author application of EARS-4…10 for an account), «Что будет
 * дальше» and «Условия автора». Slice 1 names no producer, shows no growth
 * path, no clinical case and no expert link.
 */
export function ApplyPage({
  viewer,
  homeHref,
  gate,
  form,
  disclosure,
}: ApplyPageProps) {
  return (
    <div className="bg-background pb-section-sm text-foreground md:pb-section">
      <div className="bg-hero px-gutter pb-12 pt-8 md:pb-16 md:pt-12">
        <div className="mx-auto max-w-content">
          <nav
            aria-label={copy.page.breadcrumbLabel}
            className="mb-5 text-caption font-bold md:mb-7"
          >
            <Link
              href={homeHref}
              variant="inline"
              className="text-blue-200 underline-offset-4"
            >
              {copy.page.breadcrumbHome}
            </Link>
            <span aria-hidden="true" className="mx-2 text-header-hairline">
              /
            </span>
            <span className="text-hero-muted">{copy.page.breadcrumbHere}</span>
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="text-xs font-extrabold uppercase tracking-eyebrow text-hero-muted">
              {copy.page.eyebrow}
            </p>
            <span className="inline-block rotate-2 bg-primary-surface-foreground px-3.5 py-2 text-eyebrow font-extrabold uppercase tracking-micro text-header-chip-foreground shadow-header-chip">
              {copy.page.open}
            </span>
          </div>
          <h1 className="mt-2.5 text-3xl font-extrabold leading-none tracking-display text-balance text-hero-foreground md:text-4xl">
            {copy.page.title}
          </h1>
          <p className="mt-5 max-w-panel-lead text-sm font-medium leading-relaxed text-hero-muted md:text-base">
            {copy.page.lead}
          </p>
        </div>
      </div>

      <div>
        <section className="mt-section-sm px-gutter md:mt-section">
          <div className="mx-auto max-w-content min-w-0">
            {viewer ? (
              <AuthorApplication
                viewer={viewer}
                host={form}
                disclosure={disclosure}
              />
            ) : (
              <AccountGate host={gate} />
            )}
          </div>
        </section>

        <section
          aria-labelledby="apply-path-title"
          className="mt-section-sm px-gutter md:mt-section"
        >
          <div className="mx-auto max-w-content">
            <p className="mb-2.5 text-pill font-extrabold uppercase tracking-eyebrow text-primary-action">
              {copy.path.eyebrow}
            </p>
            <h2
              id="apply-path-title"
              className="text-title-xl font-extrabold leading-display tracking-tight text-foreground md:text-3xl"
            >
              {copy.path.title}
            </h2>
            <div className="mb-stack-sm mt-4.5 border-t-2 border-foreground md:mb-stack" />
            <ol className="flex flex-col border-t-2 border-hairline md:grid md:grid-cols-2 md:gap-5 md:border-t-0 lg:grid-cols-3">
              {copy.path.steps.map((step, i) => (
                <li
                  key={step.title}
                  className="border-b-2 border-hairline py-4 md:min-h-32 md:border-2 md:border-border md:bg-card md:p-4.5"
                >
                  <p
                    aria-hidden="true"
                    className="text-xl font-extrabold tabular-nums tracking-tight text-primary-action"
                  >
                    {`0${i + 1}`}
                  </p>
                  <h3 className="mt-2 text-sm font-extrabold leading-snug text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-xs font-semibold leading-prose text-muted-foreground">
                    {step.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          aria-labelledby="apply-terms-title"
          className="mt-section-sm px-gutter md:mt-section"
        >
          <div className="mx-auto flex max-w-content flex-wrap items-start gap-4 border-2 border-border bg-card p-5 shadow-lg md:gap-8 md:p-8">
            <div className="min-w-0 flex-1 basis-64">
              <h2
                id="apply-terms-title"
                className="mb-2.5 text-pill font-extrabold uppercase tracking-eyebrow text-primary-action"
              >
                {copy.terms.title}
              </h2>
              <p className="text-lead font-extrabold leading-snug text-foreground md:text-xl">
                {copy.terms.headline}
              </p>
            </div>
            <p className="min-w-0 flex-1 basis-64 text-chip font-semibold leading-relaxed text-muted-foreground">
              {copy.terms.text}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
