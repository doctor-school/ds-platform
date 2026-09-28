import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_OPTION_LIMIT,
  freeSettlementValue,
  resolveSettlement,
  settlementOptions,
} from "./settlements";

describe("044 EARS-35 desk entry — the settlement directory", () => {
  it("EARS-35: a typed prefix offers the directory places beginning with it, each with its region", () => {
    const options = settlementOptions("Химк");
    const khimki = options.find((option) => option.label === "Химки");
    expect(khimki?.description).toBe("Московская область");
    expect(options.every((o) => o.label.toLowerCase().startsWith("химк"))).toBe(
      true,
    );
  });

  it("EARS-35: the offered list is capped, never the whole directory", () => {
    expect(settlementOptions("")).toHaveLength(SETTLEMENT_OPTION_LIMIT);
    expect(settlementOptions("к").length).toBeLessThanOrEqual(
      SETTLEMENT_OPTION_LIMIT,
    );
  });

  it("EARS-35: a federal city carries no region line — its label is its name", () => {
    const moscow = settlementOptions("Москва").find((o) => o.label === "Москва");
    expect(moscow).toBeDefined();
    expect(moscow?.description).toBeUndefined();
  });

  it("EARS-35: picking a directory place fills the region silently and shows it as the hint", () => {
    const khimki = settlementOptions("Химки").find((o) => o.label === "Химки")!;
    expect(resolveSettlement(khimki.value)).toEqual({
      city: "Химки",
      region: "Московская область",
      hint: "Московская область",
      regionField: null,
    });
  });

  it("EARS-35: a place not in the directory reveals the «Регион» field, empty", () => {
    expect(resolveSettlement(freeSettlementValue("Минск"))).toEqual({
      city: "Минск",
      region: "",
      hint: "",
      regionField: "unknown",
    });
  });

  it("EARS-35: a free value naming exactly one directory place resolves to it", () => {
    expect(resolveSettlement(freeSettlementValue("химки"))).toMatchObject({
      city: "Химки",
      region: "Московская область",
      regionField: null,
    });
  });

  it("EARS-35: a name found in several regions asks for the region", () => {
    expect(resolveSettlement(freeSettlementValue("Кировск"))).toMatchObject({
      city: "Кировск",
      region: "",
      regionField: "ambiguous",
    });
  });

  it("EARS-35: an unknown option value resolves to nothing", () => {
    expect(resolveSettlement("dir:999999")).toBeNull();
    expect(resolveSettlement(freeSettlementValue("   "))).toBeNull();
  });
});
