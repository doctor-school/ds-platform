/**
 * 028 EARS-4 — the Academy's contact channels, in ONE host constant.
 *
 * Which channels a storefront has is host copy, not design-system knowledge
 * (`@ds/design-system/contact-chip` owns the chip, never the roster), and the
 * canvas draws the roster in a single row, so it lives here as one list rather
 * than as anchors sprinkled through the page.
 *
 * Hide-until-content: a channel is listed ONLY once its real destination is
 * recorded. The canvas draws Telegram / ВКонтакте / YouTube, but only the
 * Telegram URL exists anywhere in the repo (`app/academy-home-view.tsx`); the VK
 * and YouTube destinations have never been recorded, and the canvas carries
 * `href="#"` for all three. A `#` chip is a stub that looks like a live channel,
 * so the two unrecorded channels are simply absent until their URLs arrive —
 * adding them is one line here, no layout change.
 */
export interface AcademyContactChannel {
  /** Stable id — the React key; never shown. */
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

/** The Academy's support mailbox (canvas `academy-docs.dc.html` L165). */
export const ACADEMY_CONTACT_EMAIL = "academy@doctor.school";

/**
 * The caption under the mailbox, drawn inside the «Команда Академии» card
 * (canvas `academy-docs.dc.html` L166).
 */
export const ACADEMY_MAILBOX_CAPTION =
  "Вопросы по проектам, документам и партнёрству.";

export const ACADEMY_CONTACT_CHANNELS: readonly AcademyContactChannel[] = [
  { id: "telegram", label: "Telegram", href: "https://t.me/doctorschool" },
];

/**
 * The caption under the chip row, inside the «Сообщества и соцсети» card (canvas
 * L175). Per-channel captions are deliberately absent — the canvas carries a
 * single line for the whole row.
 */
export const ACADEMY_CONTACT_CAPTION =
  "Эфиры, фрагменты подкастов, новости проектов.";

/**
 * 028 EARS-5 — the operator requisites line, one faint tabular line at the page
 * foot. Values are the legal operator's own, taken from the Bubble-export policy
 * text that `@ds/legal-content` publishes. No licence number: the Academy holds
 * no educational licence to cite, and the canvas placeholder that showed one is
 * not a fact about this operator.
 */
export const ACADEMY_REQUISITES =
  "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703";
