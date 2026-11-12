import { expect, it } from "vitest";
import { congressOwner, assertCongressDatabase } from "./congress-owner.js";

it("EARS-1: separates exact owned database attribution from regression selection", () => {
  expect(congressOwner(undefined)).toBe("3974");
  expect(congressOwner("repeat-consent-price")).toBe("3979");
  expect(congressOwner("intake")).toBe("3981");
  for (const group of [undefined, "repeat-consent-price", "intake"])
    expect(congressOwner(group, "3981")).toBe("3981");
});

it("EARS-1: rejects unknown groups and unrelated owner overrides", () => {
  expect(() => congressOwner("fourth")).toThrow();
  expect(() => congressOwner("toString")).toThrow();
  expect(() => congressOwner("intake", "")).toThrow();
  expect(() => congressOwner("intake", "9999")).toThrow();
  expect(() => congressOwner("intake", "3974")).toThrow();
  expect(() => congressOwner("repeat-consent-price", "3974")).toThrow();
});

it("EARS-1: refuses an owner/database mismatch and local disposable-CI bypass", () => {
  expect(() =>
    assertCongressDatabase(
      "postgres://test@localhost/ds_dev_3981",
      "ds_dev_3981",
      "3981",
    ),
  ).not.toThrow();
  expect(() =>
    assertCongressDatabase(
      "postgres://test@localhost/ds_dev_3979",
      "ds_dev_3979",
      "3981",
    ),
  ).toThrow();
  expect(() =>
    assertCongressDatabase(
      "postgres://test@localhost/ds_dev_3979",
      "ds_dev_3981",
      "3981",
    ),
  ).toThrow();
  expect(() =>
    assertCongressDatabase(
      "postgres://test@localhost/ds_test",
      "ds_test",
      "3981",
    ),
  ).toThrow();
  expect(() =>
    assertCongressDatabase(
      "postgres://test@localhost/ds_test",
      "ds_test",
      "3981",
      "true",
    ),
  ).not.toThrow();
});
