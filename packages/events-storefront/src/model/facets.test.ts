import { describe, expect, it } from "vitest";

import { filterLabelsOf, filterOptionsOf, resetFacetsHref } from "./facets";
import { pageHref } from "./feed-url";

const kind = [{ slug: "lecture", title: "Лекция", count: 2 }];

describe("the facet panel's options (rows 58, 59, D9)", () => {
  it("NEW: each host renders exactly its set — the doctor format/kind/specialty, the Academy project/expert/topic", () => {
    const doctor = filterOptionsOf("doctor", { kind, city: [] }, [
      { code: "cardio", name: "Кардиология" },
    ]);
    expect(doctor.format?.map((o) => o.id)).toEqual(["online", "offline", "hybrid"]);
    expect(doctor.kind).toEqual([{ id: "lecture", label: "Лекция" }]);
    expect(doctor.specialty).toEqual([{ id: "cardio", label: "Кардиология" }]);
    // No event carries a city (007) — the panel drops the facet.
    expect(doctor.city).toBeUndefined();
    expect(doctor.project).toBeUndefined();

    const academy = filterOptionsOf(
      "academy",
      { project: [{ slug: "p", title: "Школа", count: 1 }], expert: [], topic: [] },
      [],
    );
    expect(academy.project).toEqual([{ id: "p", label: "Школа" }]);
    expect(academy.format).toBeUndefined();
    expect(academy.specialty).toBeUndefined();
  });

  it("NEW: a city option is offered once the read names one", () => {
    const doctor = filterOptionsOf("doctor", { city: [{ slug: "Казань", title: "Казань", count: 1 }] }, []);
    expect(doctor.city).toEqual([{ id: "Казань", label: "Казань" }]);
  });

  it("NEW: a control whose value the data cannot distinguish is not rendered — the read's option block decides «Только с НМО»", () => {
    // 007 has no НМО flag (DEBT «PR for #1518»): no read names `nmo` options.
    expect(filterLabelsOf("doctor", { kind }).nmoOnly).toBeUndefined();
    expect(filterLabelsOf("doctor", { nmo: [{ slug: "true", title: "НМО", count: 0 }] }).nmoOnly).toBeUndefined();
    const distinguished = [
      { slug: "true", title: "С НМО", count: 2 },
      { slug: "false", title: "Без НМО", count: 3 },
    ];
    expect(filterLabelsOf("doctor", { nmo: distinguished }).nmoOnly).toBe("Только с НМО");
    expect(filterLabelsOf("academy", { nmo: distinguished }).nmoOnly).toBeUndefined();
    expect(filterLabelsOf("doctor", {}).kind).toBe("Вид события");
  });

  it("NEW: «Сбросить» clears the host's facets and keeps the view, the month and the tense", () => {
    expect(
      resetFacetsHref("/events", { view: "month", month: "2026-11", tense: "past", kind: "lecture", specialty: "all" }, "doctor"),
    ).toBe("/events?view=month&month=2026-11&tense=past");
    expect(pageHref("/webinars", { project: ["a", "b"], tense: "upcoming" })).toBe(
      "/webinars?project=a&project=b",
    );
  });
});
