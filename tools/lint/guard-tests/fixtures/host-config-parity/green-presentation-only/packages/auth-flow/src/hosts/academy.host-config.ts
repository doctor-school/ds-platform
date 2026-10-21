// Fixture: the Academy's auth-flow host values.
export const ACADEMY_AUTH_FLOW = {
  api: { basePath: "/v1/auth", registerPath: "/v1/auth/register" },
  routes: { login: "/login", register: "/register", verify: "/verify", reset: "/reset", account: "/account" },
  landing: { afterLogin: "/webinars", specialtyAware: true, specialtyFeed: "/events" },
  copy: { brand: { eyebrow: "Академия Doctor.School" } },
  brand: { wordmark: { src: "/brand/logo.svg", alt: "Doctor School" } },
  botProtection: { siteKey: undefined },
  register: { promoField: true },
  consents: { tiers: [{ tier: "access-conditions", items: [{ purpose: "partner-data-sharing", required: true }] }], wordingVersion: "2026-09-22" },
};
