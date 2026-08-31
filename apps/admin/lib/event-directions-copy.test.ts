import ru from "../messages/ru.json";
import { describe, expect, it } from "vitest";

describe("event direction operator guidance", () => {
  it("EARS-11: uses the current directions noun and catalogue section", () => {
    expect(ru.events.tabs.directions).toBe("Направления");
    expect(ru.eventDirections.title).toBe("Направления эфира");
    expect(ru.eventDirections.description.event).toContain("«Направления»");

    const visibleCopy = [
      ru.eventDirections.description.event,
      ru.eventDirections.empty.event,
      ru.eventDirections.linkTitle,
      ru.eventDirections.fields.search,
      ru.eventDirections.fields.direction,
      ru.eventDirections.fields.noOptions,
      ru.eventDirections.confirm.retireTitle,
      ru.eventDirections.confirm.restoreTitle,
    ].join(" ");
    expect(visibleCopy).not.toMatch(/тем[а-я]*/iu);
  });
});
