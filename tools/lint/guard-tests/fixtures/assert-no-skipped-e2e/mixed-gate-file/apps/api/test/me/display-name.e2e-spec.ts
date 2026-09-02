// Fixture input, not a suite: the MIXED-GATE shape, which is the majority shape
// in apps/api/test — a file-level IDP/DATABASE gate wrapping tests, one of which
// carries its own inner Centrifugo gate. The inner gate must not excuse the
// outer, IDP-gated tests.
const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "display name (e2e)",
  () => {
    it("EARS-14: a gated doctor sets their display name", () => {});

    it.skipIf(!CENTRIFUGO_URL)(
      "EARS-16: the saved name is broadcast over Centrifugo",
      () => {},
    );
  },
);
