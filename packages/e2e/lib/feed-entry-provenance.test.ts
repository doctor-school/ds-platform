import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertFeedEntryComposition, feedEntryRoot } from "./feed-entry.js";

const source = {
  layout: readFileSync(
    resolve(feedEntryRoot, "apps/doctor/app/(storefront)/layout.tsx"),
    "utf8",
  ),
  frame: readFileSync(
    resolve(feedEntryRoot, "apps/doctor/components/storefront-frame.tsx"),
    "utf8",
  ),
};

describe("017 shared shell provenance", () => {
  it("EARS-1: accepts the actual layout → Doctor frame → shared shell composition", () => {
    expect(() => assertFeedEntryComposition(source)).not.toThrow();
  });
  it("EARS-1: rejects an unused frame import and a missing children mount", () => {
    for (const layout of [
      source.layout.replace(
        "<DoctorStorefrontFrame>{children}</DoctorStorefrontFrame>",
        "<div>{children}</div>",
      ),
      source.layout.replace(
        "{children}</DoctorStorefrontFrame>",
        "</DoctorStorefrontFrame>",
      ),
      source.layout.replace("@/components/storefront-frame", "./fake-frame"),
    ])
      expect(() => assertFeedEntryComposition({ ...source, layout })).toThrow();
  });
  it("EARS-1: rejects a local shell substitute or imported but unmounted header/footer", () => {
    for (const frame of [
      source.frame.replace('"@ds/storefront-shell"', '"./fake-shell"'),
      source.frame.replace(
        "  const auth =",
        "  const StorefrontHeader = () => <header />;\n  const auth =",
      ),
      source.frame.replace(
        /<StorefrontHeader[^>]*\/>/u,
        '{"<StorefrontHeader />"}',
      ),
      source.frame.replace(
        /<StorefrontFooter[^>]*\/>/u,
        '{"<StorefrontFooter />"}',
      ),
    ])
      expect(() => assertFeedEntryComposition({ ...source, frame })).toThrow();
  });
  it("EARS-1: rejects a foreign host or disconnected shell config", () => {
    for (const frame of [
      source.frame.replace('process.env, "doctor"', 'process.env, "academy"'),
      source.frame.replace("@/lib/shell-config", "./fake-config"),
      source.frame.replaceAll("config={config}", "config={{}}"),
    ])
      expect(() => assertFeedEntryComposition({ ...source, frame })).toThrow();
  });
});
