import { describe, expect, it } from "vitest";
import {
  includeSelectedEligibleExpertUser,
  mergeEligibleExpertUserPages,
} from "./eligible-expert-users";

const first = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Иван Петров",
  identifier: "ivan@example.test",
};
const second = {
  id: "00000000-0000-4000-8000-000000000002",
  displayName: "Мария Сидорова",
  identifier: "maria@example.test",
};

describe("eligible Expert User page composition", () => {
  it("EARS-23: appends an explicitly loaded page and deduplicates by User id", () => {
    expect(mergeEligibleExpertUserPages([first], [first, second])).toEqual([
      first,
      second,
    ]);
  });

  it("EARS-19/23: retains the selected User while a search page no longer contains it", () => {
    expect(includeSelectedEligibleExpertUser([second], first)).toEqual([
      first,
      second,
    ]);
    expect(includeSelectedEligibleExpertUser([first, second], first)).toEqual([
      first,
      second,
    ]);
  });
});
