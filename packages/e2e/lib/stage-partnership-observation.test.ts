import { describe, expect, it } from "vitest";

import { stageAcademyAddress } from "./stage-partnership-observation.js";

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
