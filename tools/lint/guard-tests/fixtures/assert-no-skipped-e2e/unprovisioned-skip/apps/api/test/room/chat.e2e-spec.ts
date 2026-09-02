// Fixture input, not a suite: gated on Centrifugo, a service the api-e2e tier
// deliberately does not provision.
const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL;
describe.skipIf(
  !CENTRIFUGO_URL ||
    !process.env.DATABASE_URL ||
    !process.env.IDP_ISSUER,
)("live chat over Centrifugo (e2e)", () => {});
