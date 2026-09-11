import type { StorefrontShellConfig } from "@ds/storefront-shell";
import { academyHref } from "@/lib/academy";

/**
 * 017 EARS-1 / EARS-12 · 008 EARS-13 — the doctor storefront's HOST VALUES for
 * the shared chrome (`@ds/storefront-shell`, #2180 / epic #2020).
 *
 * This file is values only, by design: the chrome composition lives once in the
 * package and no component there branches on the host (ADR-0013 A1). Everything
 * `doctor.school` renders differently from `academy.doctor.school` — the
 * wordmark's destination, the nav, the footer columns, the giant wordmark's
 * container-query size — is a value here. A change that cannot be expressed as a
 * value in {@link StorefrontShellConfig} is a missing config field, never an
 * `if (host === "doctor")` in the package.
 *
 * `hiddenOnPaths` is deliberately ABSENT: the storefront chrome is scoped by the
 * `app/(storefront)/` route group, so the auth screens and the room — which own
 * their own chrome — never render this layout at all. Omitting it also keeps the
 * package's route-visibility client boundary out of the tree entirely.
 */
export const DOCTOR_SHELL: StorefrontShellConfig = {
  host: "doctor",

  logo: { alt: "Doctor.School — на главную", href: "/" },

  /** The BBM announcement micro-band — the same brand line on both storefronts
   *  (owner decision 2026-09-10); a value, not a package constant. */
  topbar: { text: "BBM: Академия смыслов" },

  /**
   * The header search submits to the events listing — the ONE surface this
   * storefront has that answers a query today. The dedicated results surface is
   * #1492; until it ships, the input's target is a real, shipped route rather
   * than an invented `/search` that would 404 (AGENTS.md §6 — no stub
   * affordance). The form submits `q` by GET.
   */
  search: {
    placeholder: "Поиск по эфирам",
    action: "/events",
  },

  /**
   * «Эфиры» alone. The canvas `ds-shell.dc.html` draws four items on the
   * academy artboard, but the owner decision of 2026-09-10 (Issue #2180, merged
   * 008 / 017 deltas) is that BOTH storefronts ship the single shipped
   * destination and the nav grows with features 015 / 016 and the partner
   * surface. A nav item pointing at an unbuilt route is the placeholder
   * affordance §6 forbids.
   */
  nav: [{ label: "Эфиры", href: "/events" }],

  footer: {
    navTitle: "Разделы",
    documentsTitle: "Документы и контакты",
    /**
     * The storefront legal surface (`#d-docs`, 028 EARS-1 / #1967) — all three
     * are shipped routes. There is deliberately NO «Пользовательское
     * соглашение» row: that document has no owner-approved text and no page, and
     * a footer link into nothing is a placeholder.
     */
    documents: [
      { label: "Документы и контакты", href: "/documents" },
      {
        label: "Политика персональных данных и согласия",
        href: "/documents/privacy-policy",
      },
      { label: "Контакты", href: "/documents#contacts" },
    ],
    /** 017 EARS-12 / LD-4 — the ONE crossing to the sibling storefront. */
    cross: {
      title: "Экспертам и партнёрам",
      label: "Academy.Doctor.School ↗",
      href: academyHref("/"),
      note: "Закулисье платформы: проекты, эксперты, партнёры.",
    },
    /** Education is free FOR THE DOCTOR, and the interface never names who
     *  finances it (owner hard rule) — no sponsor or funding wording here. */
    note: ["Бесплатное образование для врачей.", "© Doctor.School, 2026"],
    giant: { text: "Doctor.School", fontSize: "min(16cqw,240px)" },
  },
};
