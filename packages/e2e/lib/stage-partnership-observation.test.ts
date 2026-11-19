import { describe, expect, it } from "vitest";

import {
  stageAcademyAddress,
  stagePartnershipUnavailableOrigin,
} from "./stage-partnership-observation.js";

describe("Academy partnership stage activation", () => {
  it.each([
    ["https://academy-main.stage.example.test", "main"],
    ["https://academy-pr-4167.stage.example.test/", "pr-4167"],
  ])("recognizes the Academy slot origin %s", (input, slot) => {
    const { origin, hostname } = new URL(input);
    expect(stageAcademyAddress(input)).toEqual({ slot, origin, hostname });
  });

  it.each([
    undefined,
    "not a URL",
    "http://127.0.0.1:3001",
    "https://academy.doctor.school",
    "https://doctor-main.stage.example.test",
    "https://academy-pr-0.stage.example.test",
    "http://academy-main.stage.example.test",
    "https://academy-main.stage.example.test:8443",
    "https://academy-main.stage.example.test/#partner-form",
    "https://tester@academy-main.stage.example.test",
  ])("keeps the stage branch inactive for %s", (input) => {
    expect(stageAcademyAddress(input)).toBeUndefined();
  });
});

describe("Academy partnership outage fixture origin", () => {
  const main = stageAcademyAddress("https://academy-main.stage.example.test")!;
  const preview = stageAcademyAddress(
    "https://academy-pr-4167.stage.example.test",
  )!;

  it.each([
    [main, "main"],
    [preview, "pr-4167"],
  ])("derives the fixture for %s", (stage, slot) => {
    expect(stagePartnershipUnavailableOrigin(stage, "")).toBe(
      `https://academy-partnership-unavailable-${slot}.stage.example.test`,
    );
  });

  it("allows the operator preview to use a plain IPv4 loopback origin", () => {
    expect(
      stagePartnershipUnavailableOrigin(preview, "http://127.0.0.1:4121/"),
    ).toBe("http://127.0.0.1:4121");
    expect(() =>
      stagePartnershipUnavailableOrigin(main, "http://127.0.0.1:4121"),
    ).toThrow();
  });

  it.each([
    "http://127.0.0.1",
    "http://localhost:4121",
    "http://127.0.0.1:4121/login",
    "http://127.0.0.1:4121?fixture=1",
    "https://127.0.0.1:4121",
    "http://127.0.0.1:4121@stage.example.test",
  ])("rejects a non-loopback fixture origin %s", (input) => {
    expect(() => stagePartnershipUnavailableOrigin(preview, input)).toThrow();
  });
});
