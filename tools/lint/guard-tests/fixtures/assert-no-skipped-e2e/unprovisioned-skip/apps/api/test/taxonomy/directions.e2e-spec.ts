// Fixture input, not a suite: an IDP-gated e2e spec the guard reads to decide
// whether a skip is explained by an unprovisioned service.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "taxonomy directions (e2e)",
  () => {},
);
