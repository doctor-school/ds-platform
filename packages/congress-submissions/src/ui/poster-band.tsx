import * as React from "react";

import type { CongressSubmissionStatus } from "@ds/schemas";
import { Container } from "@ds/design-system/container";
import { Link } from "@ds/design-system/link";

import { COPY } from "../copy";
import { StatusPlate } from "./status";

/**
 * The navy poster band of the section (canvas artboard «d-lk-congress ·
 * постер-шапка»): the section title with the event line and the congress
 * page link over the list, or — with a submission open — the kind, its topic,
 * the status plate and the date line under a back link to the list.
 */

export type PosterBandProps =
  | {
      mode: "list";
      accountHref: string;
      eventLine: string | null;
      eventHref: string | null;
    }
  | {
      mode: "detail";
      eyebrow: string;
      topic: string;
      status: CongressSubmissionStatus;
      dateLine: string;
      onBack: () => void;
    };

export function PosterBand(props: PosterBandProps) {
  return (
    <div
      data-screen-label="d-lk-congress · постер-шапка"
      className="bg-hero pb-9 pt-7 text-hero-foreground layout:pb-12 layout:pt-10"
    >
      <Container>
        {props.mode === "list" ? (
          <>
            <nav className="mb-5.5">
              <Link href={props.accountHref} tone="header-nav" size="sm">
                {COPY.backToAccount}
              </Link>
            </nav>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-balance layout:text-5xl">
                  {COPY.title}
                </h1>
                {props.eventLine ? (
                  <p className="mt-3 text-body-compact font-medium text-hero-muted">
                    {props.eventLine}
                  </p>
                ) : null}
              </div>
              {props.eventHref ? (
                <Link
                  href={props.eventHref}
                  tone="on-primary"
                  variant="inline"
                  size="sm"
                  weight="strong"
                  className="mb-1"
                >
                  {COPY.eventPage}
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <nav className="mb-5.5">
              <Link asChild tone="header-nav" size="sm">
                <button type="button" onClick={props.onBack}>
                  {COPY.backToList}
                </button>
              </Link>
            </nav>
            <p className="mb-2.5 text-caption font-semibold text-hero-muted">
              {props.eyebrow}
            </p>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h1 className="min-w-60 flex-1 text-2xl font-extrabold leading-tight tracking-tight text-balance layout:text-4xl">
                {props.topic}
              </h1>
              <StatusPlate status={props.status} />
            </div>
            <p className="mt-3 text-sm font-medium text-hero-muted">
              {props.dateLine}
            </p>
          </>
        )}
      </Container>
    </div>
  );
}
