/**
 * 028 EARS-4 / EARS-5 (#1967) — the doctor storefront's contact channels and its
 * legal requisites, defined ONCE.
 *
 * The `/documents` page is the only surface that renders them today, but they are
 * facts about the operator rather than about that page: a second surface (a
 * support entry point, an email footer) must read them from here instead of
 * re-typing an address that then drifts.
 *
 * THE CHANNEL ROSTER. The canvas (`design-source/doctor-docs.dc.html` L167-169)
 * draws three chips with `href="#"`: it fixes the SHAPE of the row, not the
 * destinations. The destinations are the operator's own channels — Telegram,
 * ВКонтакте, RuTube — and each entry below carries a real URL, because a `#`
 * chip is a dead affordance that looks like a live channel.
 */
export interface ContactChannel {
  /** Stable key — the React key and the row's `data-testid` suffix. */
  readonly key: string;
  readonly label: string;
  /** A real destination. Never `#`. */
  readonly href: string;
}

/** Support mailbox (canvas «Поддержка», `028-product.md` L99). */
export const SUPPORT_EMAIL = "support@doctor.school";

/** The caption under the mailbox, verbatim from the canvas (L162). */
export const SUPPORT_CAPTION = "Мы отвечаем в рабочие дни.";

/**
 * Community channels, in canvas order: Telegram, ВКонтакте, RuTube. The Academy
 * storefront publishes the same roster from its own host copy
 * (`apps/portal/lib/contacts.ts`) — the list is host copy, not a shared unit.
 */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  { key: "telegram", label: "Telegram", href: "https://t.me/DoctorSchool" },
  { key: "vk", label: "ВКонтакте", href: "https://vk.ru/doctor.school" },
  {
    key: "rutube",
    label: "RuTube",
    href: "https://rutube.ru/channel/33533508/",
  },
];

/**
 * EARS-5 — one requisites line, no licence number in R1. The values are the
 * operator's, taken from the legacy legal texts the owner exported
 * (`028-product.md` L179); the canvas line carries placeholder values by
 * construction and is the LAYOUT reference only.
 */
export const REQUISITES_LINE =
  "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703";
