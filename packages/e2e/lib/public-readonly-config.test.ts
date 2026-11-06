import { afterEach, expect, it, vi } from "vitest";
import { publicReadonlyOriginals } from "./public-readonly-originals.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("EARS-12: the owned contour runs Academy once and Doctor twice with zero retries", async () => {
  vi.stubEnv("E2E_PUBLIC_READONLY", "1");
  vi.stubEnv("E2E_FEED_ENTRY_BOOT", "0");
  vi.resetModules();
  const { default: config } = await import("../feed-entry.config.js");
  expect(config.projects!.map((project) => project.name)).toEqual([
    "doctor",
    "academy",
  ]);
  for (const { host, title } of publicReadonlyOriginals) {
    const selected = config.projects!.filter((project) =>
      (project.grep as RegExp).test(`${host} feature ${title} @host:${host}`),
    );
    expect(selected.map((project) => project.name)).toEqual([host]);
  }
  expect(config.retries).toBe(0);
});
