// Fixture: the Academy's auth-flow host values.
export const ACADEMY_AUTH_FLOW = {
  api: { basePath: "/v1/auth", registerPath: "/v1/auth/register" },
  routes: { login: "/login", register: "/register", verify: "/verify", reset: "/reset", account: "/account" },
  landing: { afterLogin: "/webinars", specialtyAware: false },
  copy: { brand: { eyebrow: "Академия Doctor.School" } },
  brand: { wordmark: { src: "/brand/logo.svg", alt: "Doctor School" } },
  botProtection: { siteKey: undefined },
  register: { promoField: false },
  consents: { tiers: [{ tier: "access-conditions", items: [{ purpose: "tos", required: true }] }], wordingVersion: "2026-01" },
};
