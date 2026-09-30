// Fixture: the doctor storefront's auth-flow host values.
export const DOCTOR_AUTH_FLOW = {
  api: { basePath: "/v1/auth", registerPath: "/v1/storefront/doctor/register" },
  routes: { login: "/login", register: "/register", verify: "/verify", reset: "/reset", account: "/account" },
  landing: { afterLogin: "/", specialtyAware: true, specialtyFeed: "/events" },
  brand: { wordmark: { src: "/brand/logo.svg", alt: "Doctor.School" } },
  botProtection: { siteKey: undefined },
  channels: ["email"],
  register: { promoField: true },
  consents: { tiers: [{ tier: "access-conditions", items: [{ purpose: "partner-data-sharing", required: true }] }], wordingVersion: "2026-09-22" },
};
