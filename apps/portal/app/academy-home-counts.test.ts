import { afterEach, describe, expect, it, vi } from "vitest";

import {
  expertCountLine,
  partnerCountLine,
  pluralRu,
  readPublicExpertCount,
  readPublicOrganisationCount,
  readPublicProjects,
  runningProjectCount,
} from "./academy-home-counts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function project(slug: string, stage: "running" | "soon" | "completed") {
  return {
    slug,
    title: slug,
    description: null,
    coverUrl: null,
    stage,
    stageNote: null,
    outputs: [],
    investor: null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("029 V-2 — the hero count lines", () => {
  it("029 EARS-3: the «Экспертам» line takes the Russian plural form of each number (1 / 2 / 5 / 12 / 21)", () => {
    const cases: Array<[number, string, string]> = [
      [1, "1 проект в производстве", "1 эксперт"],
      [2, "2 проекта в производстве", "2 эксперта"],
      [5, "5 проектов в производстве", "5 экспертов"],
      [12, "12 проектов в производстве", "12 экспертов"],
      [21, "21 проект в производстве", "21 эксперт"],
    ];
    for (const [n, projects, experts] of cases) {
      expect(expertCountLine({ running: n, experts: n })).toBe(
        `${projects} · ${experts}`,
      );
    }
    expect(expertCountLine({ running: 3, experts: 12 })).toBe(
      "3 проекта в производстве · 12 экспертов",
    );
  });

  it("029 EARS-3: a zero or failed segment is left out with its separator, and no line renders when both drop", () => {
    // Scenario «Zero projects in production drop that segment».
    expect(expertCountLine({ running: 0, experts: 12 })).toBe("12 экспертов");
    expect(expertCountLine({ running: null, experts: 12 })).toBe(
      "12 экспертов",
    );
    expect(expertCountLine({ running: 3, experts: 0 })).toBe(
      "3 проекта в производстве",
    );
    expect(expertCountLine({ running: 3, experts: null })).toBe(
      "3 проекта в производстве",
    );
    expect(expertCountLine({ running: 0, experts: 0 })).toBeNull();
    expect(expertCountLine({ running: null, experts: null })).toBeNull();
    expect(expertCountLine({ running: 0, experts: null })).toBeNull();
  });

  it("029 EARS-3: the running count is the number of catalog items at the stage `running`; a failed catalog read gives no count", () => {
    expect(
      runningProjectCount({
        data: [
          project("a", "running"),
          project("b", "soon"),
          project("c", "running"),
          project("d", "completed"),
          project("e", "running"),
        ],
      }),
    ).toBe(3);
    expect(runningProjectCount({ data: [project("b", "soon")] })).toBe(0);
    expect(runningProjectCount(null)).toBeNull();
  });

  it("029 EARS-5: the «Партнёрам» line takes the Russian plural form of the count (1 / 2 / 5 / 12 / 21)", () => {
    expect(partnerCountLine(1)).toBe("1 партнёр · прозрачная модель");
    expect(partnerCountLine(2)).toBe("2 партнёра · прозрачная модель");
    expect(partnerCountLine(5)).toBe("5 партнёров · прозрачная модель");
    expect(partnerCountLine(12)).toBe("12 партнёров · прозрачная модель");
    expect(partnerCountLine(14)).toBe("14 партнёров · прозрачная модель");
    expect(partnerCountLine(21)).toBe("21 партнёр · прозрачная модель");
  });

  it("029 EARS-5: a zero or failed partner count shows «Прозрачная модель» alone", () => {
    // Scenario «A count the platform cannot give is left out».
    expect(partnerCountLine(0)).toBe("Прозрачная модель");
    expect(partnerCountLine(null)).toBe("Прозрачная модель");
  });

  it("029 EARS-3: the plural helper picks one / few / many by the last two digits", () => {
    const forms = ["проект", "проекта", "проектов"] as const;
    expect(pluralRu(11, forms)).toBe("проектов");
    expect(pluralRu(14, forms)).toBe("проектов");
    expect(pluralRu(22, forms)).toBe("проекта");
    expect(pluralRu(101, forms)).toBe("проект");
    expect(pluralRu(111, forms)).toBe("проектов");
  });
});

describe("029 V-2 — the three public reads, each settled on its own", () => {
  it("029 EARS-3: each read answers its value at the moment of the request, uncached", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/public/projects")) {
        return json({ data: [project("a", "running"), project("b", "soon")] });
      }
      if (url.endsWith("/v1/public/experts/count")) return json({ count: 12 });
      if (url.endsWith("/v1/public/organisations/count")) {
        return json({ count: 14 });
      }
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readPublicProjects()).resolves.toEqual({
      data: [project("a", "running"), project("b", "soon")],
    });
    await expect(readPublicExpertCount()).resolves.toBe(12);
    await expect(readPublicOrganisationCount()).resolves.toBe(14);
    for (const [, init] of fetchMock.mock.calls as unknown as Array<
      [unknown, RequestInit]
    >) {
      expect(init.cache).toBe("no-store");
    }
  });

  it("029 EARS-3 / EARS-5: a rejected, non-OK or malformed read resolves to no value and never rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(readPublicProjects()).resolves.toBeNull();
    await expect(readPublicExpertCount()).resolves.toBeNull();
    await expect(readPublicOrganisationCount()).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "boom" }, 503)),
    );
    await expect(readPublicOrganisationCount()).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ count: "many" })),
    );
    await expect(readPublicExpertCount()).resolves.toBeNull();
  });
});
