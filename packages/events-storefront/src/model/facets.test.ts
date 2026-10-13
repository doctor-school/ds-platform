import { describe, expect, it } from "vitest";

import {
  appliedFacetsOf,
  filterLabelsOf,
  filterOptionsOf,
  resetFacetsHref,
  withKnownKinds,
} from "./facets";
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

  it("EARS-7: the kind dictionary names an applied kind the read does not offer", () => {
    const doctor = filterOptionsOf("doctor", { kind, city: [] }, [], [
      { slug: "master-klass", title: "Мастер-класс" },
    ]);
    expect(doctor.kind).toEqual([{ id: "lecture", label: "Лекция" }]);
    expect(doctor.appliedNames).toEqual({
      kind: [{ id: "master-klass", label: "Мастер-класс" }],
    });
    expect(filterOptionsOf("doctor", { kind, city: [] }, []).appliedNames).toBeUndefined();
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

describe("the URL's facets as the panel's applied set (019 EARS-7)", () => {
  it("EARS-7: an applied kind no published or retired kind carries (never existed, a draft, deleted) is dropped from the reading like an unknown format; a retired one stays", () => {
    const dictionary = [
      { slug: "vebinar", title: "Вебинар" },
      // Retired — the public kind read still names it (012 Amendment — 2026-10-13).
      { slug: "master-klass", title: "Мастер-класс" },
    ];
    expect(
      withKnownKinds(
        { tense: "past", kind: ["master-klass", "ghost", "vebinar"], format: "online" },
        dictionary,
      ),
    ).toEqual({ tense: "past", kind: ["master-klass", "vebinar"], format: "online" });
    expect(withKnownKinds({ kind: "ghost", q: "сон" }, dictionary)).toEqual({ q: "сон" });
    // No kind applied, nothing to check.
    expect(withKnownKinds({ q: "сон" }, dictionary)).toEqual({ q: "сон" });
  });

  it("EARS-7: a failed kind-dictionary read drops nothing — an applied kind is never lost to a transient failure", () => {
    const raw = { kind: ["master-klass", "ghost"] };
    expect(withKnownKinds(raw, null)).toBe(raw);
  });

  it("EARS-7: a format value outside the fixed set is not an applied facet — it could never be shown or counted", () => {
    expect(appliedFacetsOf({ format: ["online", "radio"] }).format).toEqual([
      "online",
    ]);
  });

  it("EARS-7: a kind slug stays applied even when the read no longer offers it — the panel shows it as removable", () => {
    expect(appliedFacetsOf({ kind: ["retired-kind"] }).kind).toEqual([
      "retired-kind",
    ]);
  });
});
