import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import ordinaryConfig from "../playwright.config.js";
import {
  feedEntryRoot,
  feedEntryTask,
  ownedFeedEntryDatabase,
} from "./feed-entry.js";
import { publicProjectRefusalTitles } from "./host-tags.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("EARS-19: keeps the inherited Academy identity and retained five CI arms while adding exactly the project contour", async () => {
  vi.stubEnv("E2E_PUBLIC_PROJECT_REFUSALS", "1");
  vi.stubEnv("E2E_FEED_ENTRY_BOOT", "0");
  const { default: config } = await import("../feed-entry.config.js");
  expect(config.projects!.map((project) => project.name)).toEqual(["academy"]);
  expect(config.retries).toBe(0);
  for (const title of publicProjectRefusalTitles) {
    expect((config.grep as RegExp).test(title)).toBe(true);
    expect((ordinaryConfig.grepInvert as RegExp).test(title)).toBe(true);
  }
  const workflow = parse(
    readFileSync(
      resolve(feedEntryRoot, ".github/workflows/public-feed-entry.yml"),
      "utf8",
    ),
  );
  expect(workflow.jobs["public-feed-entry"].strategy.matrix.task).toEqual([
    3751, 3772, 3785, 3789, 3797, 3826,
  ]);
  expect(feedEntryTask()).toBe(3826);
  expect(
    ownedFeedEntryDatabase("postgres://ds:secret@localhost/ds_dev_3826"),
  ).toContain("/ds_dev_3826");
  for (const name of ["ds_dev", "ds_dev_38260", "ds_dev_3804", "production"])
    expect(() =>
      ownedFeedEntryDatabase(`postgres://ds:secret@localhost/${name}`),
    ).toThrow("dedicated #3826");
});
