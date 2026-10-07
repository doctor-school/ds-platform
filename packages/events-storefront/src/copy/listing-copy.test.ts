import { describe, expect, it } from "vitest";

import { DEFAULT_EVENT_NOUN } from "../model/event-count";
import { LISTING_COPY, eventNounOf } from "./listing-copy";

// The parameterised sentences moved from the Academy's ICU catalogue
// (`{count, plural, one … few … many …}`) to the one plural rule
// (`formatEventCount`). These pin that each renders the same forms the ICU
// message rendered for 1 / 2 / 5 / 11 / 21 — the move is zero behaviour change.
const EFIR = { one: "эфир", few: "эфира", many: "эфиров" };

describe("LISTING_COPY plural sentences", () => {
  it("archive subtitle pluralises the record noun like the ICU message", () => {
    expect(LISTING_COPY.archiveSubtitle(1)).toBe(
      "Архив · 1 запись · доступ после входа",
    );
    expect(LISTING_COPY.archiveSubtitle(3)).toBe(
      "Архив · 3 записи · доступ после входа",
    );
    expect(LISTING_COPY.archiveSubtitle(11)).toBe(
      "Архив · 11 записей · доступ после входа",
    );
  });

  it("month subtitle pluralises the host noun and the schools", () => {
    expect(LISTING_COPY.month.subtitle(21, 2, EFIR)).toBe(
      "21 эфир · 2 школы · время — МСК",
    );
    expect(LISTING_COPY.month.subtitle(5, 1, EFIR)).toBe(
      "5 эфиров · 1 школа · время — МСК",
    );
    expect(LISTING_COPY.month.subtitle(0, 0, EFIR)).toBe(
      "0 эфиров · 0 школ · время — МСК",
    );
  });

  it("picker and day counts use the host noun; the default noun is «событие»", () => {
    expect(LISTING_COPY.month.pickerCount(2, EFIR)).toBe("2 эфира");
    expect(LISTING_COPY.month.dayEventsLabel(1, EFIR)).toBe("1 эфир");
    expect(eventNounOf(undefined)).toBe(DEFAULT_EVENT_NOUN);
    expect(eventNounOf({ eventNoun: EFIR })).toBe(EFIR);
  });

  it("interpolated links and card date keep their shape", () => {
    expect(LISTING_COPY.month.moreLink(4)).toBe("+4 ещё");
    expect(LISTING_COPY.month.nextMonthLink("Август 2026")).toBe(
      "Август 2026 →",
    );
    expect(LISTING_COPY.month.prevMonthLink("Июнь 2026")).toBe("← Июнь 2026");
    expect(LISTING_COPY.cardDate("9 июля", "чт")).toBe("9 июля · чт");
  });
});
