import Image from "next/image";
import NextLink from "next/link";
import { Link } from "@ds/design-system/link";
import styles from "./storefront-footer.module.css";

/**
 * 017 EARS-1 / EARS-12 — the storefront footer, defined ONCE (canvas
 * `d-home · футер`): three columns — the brand line, «Документы и контакты»,
 * and the SINGLE Academy crossing of this surface.
 *
 * EARS-12 is the load-bearing constraint here: the storefront carries no Academy
 * content of its own, and column 3 holds the one and only link out to
 * `academy.doctor.school` (LD-4). There is deliberately no Academy entry in the
 * header nav and no Academy block anywhere on the page — a second occurrence is
 * a defect, and `e2e/shell.spec.ts` counts them.
 *
 * Column 1 states that education is free FOR THE DOCTOR and stops there: the
 * interface never names who finances that learning (owner hard rule), so no
 * sponsor, partner or funding wording belongs in this footer.
 *
 * The «Документы и контакты» links target the storefront legal surface
 * (`#d-docs` in the two-site IA), a separate tracked deliverable; they are
 * forward references to a real planned route rather than `#` placeholders, and
 * `apps/doctor` is not publicly routed yet (no compose service, no Caddy vhost —
 * prod-surface manifest), so no visitor can reach them ahead of that page.
 */
const DOCUMENT_LINKS = [
  { href: "/documents#user-agreement", label: "Пользовательское соглашение" },
  {
    href: "/documents#personal-data",
    label: "Политика обработки персональных данных",
  },
  { href: "/documents#contacts", label: "Контакты" },
] as const;

/** LD-4 — the one Academy crossing on the doctor storefront. */
const ACADEMY_HREF = "https://academy.doctor.school/";

export function StorefrontFooter() {
  return (
    <footer
      data-testid="storefront-footer"
      className="border-t-2 border-border px-4 pb-9 pt-8 layout:px-12 layout:pb-14 layout:pt-12"
    >
      <div className="mx-auto grid w-full max-w-container-content gap-8 layout:grid-cols-3 layout:gap-10">
        <div>
          {/*
            The brand mark is the vector wordmark, not set text (canvas
            `d-home · футер`). The footer sits on the page surface, not the navy
            band, so the canvas swaps the asset with the theme: the colour mark on
            light, the white one on dark. Both are painted and CSS picks one, so
            the choice needs no client component and cannot flash the wrong mark
            before hydration; only the visible one carries the accessible name.
          */}
          <Image
            src="/brand/logo.svg"
            alt="Doctor.School"
            width={500}
            height={164}
            unoptimized
            className={`${styles.logoColor} h-5.5 w-auto`}
          />
          <Image
            src="/brand/logo-white.svg"
            alt=""
            aria-hidden="true"
            width={500}
            height={164}
            unoptimized
            className={`${styles.logoWhite} h-5.5 w-auto`}
          />
          <p className="mt-3.5 text-caption font-semibold leading-relaxed text-muted-foreground">
            Бесплатное образование для врачей.
            <br />© Doctor.School, 2026
          </p>
        </div>

        <div data-testid="footer-documents">
          <h2 className="mb-3.5 text-caption font-extrabold uppercase tracking-widest text-muted-foreground">
            Документы и контакты
          </h2>
          <ul className="flex flex-col gap-2.5">
            {DOCUMENT_LINKS.map((item) => (
              <li key={item.href}>
                <Link asChild className="text-sm">
                  <NextLink href={item.href}>{item.label}</NextLink>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3.5 text-caption font-extrabold uppercase tracking-widest text-muted-foreground">
            Экспертам и партнёрам
          </h2>
          <Link
            variant="inline"
            href={ACADEMY_HREF}
            className="text-sm font-extrabold"
          >
            Academy.Doctor.School ↗
          </Link>
          <p className="mt-2.5 text-caption font-semibold leading-relaxed text-muted-foreground">
            Закулисье платформы: проекты, эксперты, партнёры.
          </p>
        </div>
      </div>
    </footer>
  );
}
