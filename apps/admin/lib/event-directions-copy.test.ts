import ru from "../messages/ru.json";
import { describe, expect, it } from "vitest";

describe("event direction operator guidance", () => {
  it("EARS-11: uses the current directions noun and catalogue section", () => {
    expect(ru.events.tabs.topics).toBe("Направления");
    expect(ru.eventTopics.title).toBe("Направления эфира");
    expect(ru.eventTopics.description.event).toContain("«Направления»");

    const visibleCopy = [
      ru.eventTopics.description.event,
      ru.eventTopics.empty.event,
      ru.eventTopics.linkTitle,
      ru.eventTopics.fields.search,
      ru.eventTopics.fields.topic,
      ru.eventTopics.fields.noOptions,
      ru.eventTopics.confirm.retireTitle,
      ru.eventTopics.confirm.restoreTitle,
    ].join(" ");
    expect(visibleCopy).not.toMatch(/тем[а-я]*/iu);
  });
});
