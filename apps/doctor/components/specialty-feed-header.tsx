"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Link } from "@ds/design-system/link";
import {
  type SpecialtyChoice,
  type SpecialtyRef,
  specialtyFeedPath,
} from "@ds/schemas";

import { SpecialtyCatalog } from "@/components/specialty-catalog";
import type { SpecialtyActor } from "@/lib/specialty-choice";

/** Canvas copy (`design-source/doctor-feed.dc.html`, «d-feed · постер-шапка»). */
const COPY = {
  home: "Doctor.School",
  specialties: "Специальности",
  kicker: "Лента специальности",
  change: "сменить специальность ▾",
  breadcrumbLabel: "Хлебные крошки",
} as const;

/**
 * 018 EARS-1 (#1496) — the specialty feed's breadcrumbs and specialty heading
 * on the poster band of the canvas, inside 017's shell (the feed defines no
 * header, navigation or footer of its own — those are the layout's).
 *
 * «сменить специальность» re-opens feature 017's catalog — the SAME
 * `SpecialtyCatalog` the home mounts, in its «сменить» state over the
 * remembered choice — right below the band. A choice is recorded by 017's own
 * command; the feed then follows it to the newly chosen specialty's feed.
 *
 * The page owns the route's one `h1`: the specialty name. The canvas
 * statistics line (EARS-3) and its payer sentence (a known canvas defect,
 * LD-9) are not part of this band.
 */
export function SpecialtyFeedHeader({
  specialty,
  actor,
  initialChoice,
}: {
  specialty: SpecialtyRef;
  actor: SpecialtyActor;
  initialChoice: SpecialtyChoice | null;
}) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const onChosen = useCallback(
    (chosen: SpecialtyRef) => {
      setChanging(false);
      if (chosen.code !== specialty.code) {
        router.push(specialtyFeedPath(chosen.code));
      }
    },
    [router, specialty.code],
  );

  return (
    <>
      <section
        className="bg-hero px-4 py-10 text-hero-foreground layout:px-12 layout:py-14"
        data-testid="specialty-feed-header"
      >
        <div className="mx-auto w-full max-w-content">
          <nav
            aria-label={COPY.breadcrumbLabel}
            className="mb-5 flex flex-wrap items-center gap-2 text-caption font-bold text-hero-muted"
            data-testid="specialty-feed-breadcrumbs"
          >
            <Link asChild tone="on-primary">
              <NextLink href="/">{COPY.home}</NextLink>
            </Link>
            <span aria-hidden="true">/</span>
            <span>{COPY.specialties}</span>
          </nav>
          <p className="mb-3.5 text-xs font-extrabold uppercase tracking-widest text-hero-muted">
            {COPY.kicker}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-balance layout:text-5xl">
              {specialty.name}
            </h1>
            {/* A disclosure, so a `<button>`; the canvas draws it as the
                band's underlined link, which is the Link primitive's
                on-primary inline shape. */}
            <Link asChild size="sm" tone="on-primary" variant="inline">
              <button
                aria-controls="specialty-feed-catalog"
                aria-expanded={changing}
                data-testid="specialty-feed-change"
                onClick={() => setChanging((open) => !open)}
                type="button"
              >
                {COPY.change}
              </button>
            </Link>
          </div>
        </div>
      </section>
      {changing ? (
        <div id="specialty-feed-catalog" data-testid="specialty-feed-catalog">
          <SpecialtyCatalog
            actor={actor}
            initialChoice={initialChoice}
            reopened
            onChosen={onChosen}
          />
        </div>
      ) : null}
    </>
  );
}
