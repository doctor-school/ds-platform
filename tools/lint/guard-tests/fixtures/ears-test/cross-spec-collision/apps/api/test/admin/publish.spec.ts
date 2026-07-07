// 007 publish test — the top-level describe carries the `007 EARS-4` feature
// prefix, so every EARS id cited in THIS file is scoped to feature 007. Its
// EARS-4 therefore covers 007's EARS-4 only — it must never satisfy or stale
// 003's separately-numbered EARS-4 (the #612 defect). The `describe.skipIf(...)`
// method-chain mirrors the real 007 e2e suite: the feature-scope scan must still
// see the `007` prefix even though the generic title regex skips the chained call.
describe.skipIf(!process.env.DATABASE_URL)(
  "007 EARS-4 publish transition (e2e)",
  () => {
    it("EARS-4: publishing a draft event transitions it to published", () => {});
    it("EARS-4: publish is refused for every non-draft state", () => {});
  },
);
