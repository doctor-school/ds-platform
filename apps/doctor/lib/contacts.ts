/**
 * 028 EARS-4 / EARS-5 (#1967) — the doctor storefront's contact channels and its
 * legal requisites, defined ONCE.
 *
 * The `/documents` page is the only surface that renders them today, but they are
 * facts about the operator rather than about that page: a second surface (a
 * support entry point, an email footer) must read them from here instead of
 * re-typing an address that then drifts.
 *
 * WHY THE CHANNEL LIST IS SHORT. The canvas (`design-source/doctor-docs.dc.html`
 * L167-169) draws Telegram / ВКонтакте / YouTube chips, but it draws all three
 * with `href="#"` — the canvas fixes the SHAPE, not the destinations, and the VK
 * and YouTube URLs are not recorded anywhere in this repo. A `#` chip is a dead
 * affordance, and the owner's rule for this exact case is «hide until content»:
 * a channel appears here the moment its real URL exists, and adding one is this
 * one array literal.
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
 * Community channels, in canvas order. Telegram's URL is the one already in
 * production on the Academy home view (`apps/portal/app/academy-home-view.tsx`);
 * ВКонтакте and YouTube join this array when their URLs are recorded.
 */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  { key: "telegram", label: "Telegram", href: "https://t.me/doctorschool" },
];

/**
 * EARS-5 — one requisites line, no licence number in R1. The values are the
 * operator's, taken from the legacy legal texts the owner exported
 * (`028-product.md` L179); the canvas line carries placeholder values by
 * construction and is the LAYOUT reference only.
 */
export const REQUISITES_LINE =
  "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703";
