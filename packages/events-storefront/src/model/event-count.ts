/**
 * The host's event noun in its three Russian count forms — a copy value, never a
 * rule (wave-2 entry gate §4.4 `copy.eventNoun`, §2.1 row 5). `one` follows 1,
 * 21, 101…; `few` follows 2–4, 22–24…; `many` follows 0, 5–20, 25–30….
 */
export interface PluralNoun {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

/** The default event noun; a host overrides it through `copy.eventNoun` (the Academy: «эфир»). */
export const DEFAULT_EVENT_NOUN: PluralNoun = {
  one: "событие",
  few: "события",
  many: "событий",
};

const RU_PLURAL = new Intl.PluralRules("ru-RU");

/**
 * The ONE plural rule for an event count — «1 событие», «2 события», «5 событий»
 * — with the host's noun from copy. The form comes from the `ru` CLDR plural
 * category of `Intl.PluralRules`, so the teens (11–14) and the tens (21, 22) are
 * the platform's rule, not a hand-rolled modulo table.
 */
export function formatEventCount(
  count: number,
  noun: PluralNoun = DEFAULT_EVENT_NOUN,
): string {
  const category = RU_PLURAL.select(count);
  const form =
    category === "one" ? noun.one : category === "few" ? noun.few : noun.many;
  return `${count} ${form}`;
}
