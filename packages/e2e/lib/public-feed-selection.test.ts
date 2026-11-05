import { expect, it } from "vitest";
import ordinaryConfig from "../playwright.config.js";
import {
  publicFeedStatePattern,
  publicFeedStateTitles,
} from "./host-tags.js";

it("EARS-1: ordinary storefront runs cannot execute fixture-only 018 originals even with a matching grep", () => {
  expect(ordinaryConfig.grepInvert).toBe(publicFeedStatePattern);
  for (const title of publicFeedStateTitles)
    expect(
      (ordinaryConfig.grepInvert as RegExp).test(
        `doctor ${title} @host:doctor @EARS-4`,
      ),
    ).toBe(true);
  expect(ordinaryConfig.retries).toBe(0);
  expect(ordinaryConfig.projects!.map((project) => project.name)).toEqual([
    "academy",
    "doctor",
    "walks",
    "login",
  ]);
});
