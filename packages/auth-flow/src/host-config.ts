import type { BotProtectionMessages } from "@ds/design-system/blocks";
import type { OtpChannel } from "@ds/schemas";

/**
 * The DATA a host states about itself so the ONE auth flow can serve it
 * (wave-1 entry gate §4.2, epic #2020 / #2027).
 *
 * Data only. There is no function-valued field here and the wave-1 adapter list
 * is CLOSED and EMPTY (gate §4.3): a divergence that fits neither a field below
 * nor a recorded owner decision is a question for the owner, never a host-local
 * variant of a rule the package owns.
 *
 * The type grows ONE PR at a time, with the surfaces that consume it. PR 1.3
 * declared the transport, the copy, the bot-protection value, the channels and
 * the promo box; PR 1.4 adds the route table and the `returnTo` parking, which
 * are what the server session read, the signed-in guard and the return-target
 * codec consume. The consent tiers, the brand assets and the landing table of
 * gate §4.2 arrive with PRs 1.5–1.8; a field nothing reads yet would be a claim,
 * not a contract.
 */

/** The fields the shared registration/confirmation rules know about (row 9). */
export type AuthFlowFieldName = "email" | "password" | "promoCode" | "code";

/** The two sentences one field slot can show: the empty box and the rule break. */
export type AuthFlowFieldCopy = {
  /** The empty-box message, for a field this host requires. */
  readonly required?: string;
  /** The rule-violation message. */
  readonly invalid: string;
};

/**
 * The sentences the ONE error dictionary resolves to (rows 10–15).
 *
 * The dictionary owns the BRANCH — which status is an account oracle and which
 * is not — and the host owns the WORDING, which is why every entry here is a
 * host value rather than a package constant. `AuthFlowErrorCopy` carries no
 * per-action generic: that one is supplied by the CALLER at the call site (row
 * 11), so a verification failure never says «войти».
 */
export type AuthFlowErrorCopy = {
  /** 429 — a rate limit, never a wrong-credential sentence (row 12). */
  readonly tooManyAttempts: string;
  /** 5xx and a rejected `fetch` — availability, not an oracle (row 14). */
  readonly unavailable: string;
  /** `BOT_PROTECTION_REQUIRED` — the real obstacle, not the credential (row 15). */
  readonly botProtectionRequired: string;
  /** `BOT_PROTECTION_REJECTED` — the refused or expired token (rows 15, 19). */
  readonly botProtectionRejected: string;
};

/** Everything this host says in its own words. */
export type AuthFlowCopy = {
  readonly errors: AuthFlowErrorCopy;
  /** The four-state challenge copy the shared block's failures map onto (row 15). */
  readonly botProtection: BotProtectionMessages;
  /**
   * One entry per field this host SERVES. `promoCode` is present exactly when
   * `register.promoField` is true (row 9) — a host without the field states no
   * copy for it rather than a placeholder sentence nothing renders.
   */
  readonly fields: {
    readonly email: AuthFlowFieldCopy;
    readonly password: AuthFlowFieldCopy;
    readonly code: AuthFlowFieldCopy;
    readonly promoCode?: AuthFlowFieldCopy;
  };
};

/**
 * The relative BFF paths this host proxies to the api (row 6).
 *
 * RELATIVE by contract: every call has to ride THIS origin so the origin-locked
 * `__Host-ds_session` cookie travels with it, which is the whole point of each
 * host's `/v1/:path*` rewrite. Only the paths that genuinely DIFFER per host are
 * data; every other endpoint of the table is a package constant.
 */
export type AuthFlowApiConfig = {
  /** The 003 auth root — `/v1/auth` on both hosts today. */
  readonly basePath: string;
  /** `/v1/auth/register` on the Academy, the storefront command on the doctor host. */
  readonly registerPath: string;
  /** `/v1/auth/verify` on the Academy, the storefront confirm command on the doctor host. */
  readonly confirmPath: string;
};


/**
 * The route table this host serves (gate §4.2).
 *
 * Data, never a resolver: every entry is a path this host states about itself,
 * so the package's server-side guard can decide where a visitor belongs without
 * ever calling back into the app (gate §4.3 — the wave-1 adapter list is empty).
 */
export type AuthFlowRoutes = {
  readonly login: string;
  readonly register: string;
  /** `undefined` = the confirmation is an inline step on this host (rows 51, 76). */
  readonly verify?: string;
  readonly reset: string;
  /** #1987 — the account path the return-target codec admits as a shape (row 32). */
  readonly account: string;
  /**
   * Q3 (rows 26–28) — the auth paths an AUTHENTICATED visitor may still be shown.
   *
   * Read SERVER-side by the one guard. `/reset` is on it because 003 EARS-28
   * pins the `/account` change-password action as a handoff to the existing
   * reset flow, so a signed-in doctor must be able to complete it; everything
   * off this list is closed to a visitor who already holds a session.
   */
  readonly allowAuthenticated: readonly string[];
};

/**
 * `returnTo` parking (rows 29–31). `undefined` on a host that parks nothing —
 * the doctor storefront carries the target on the canonical query param and has
 * no cookie at all, which is a host fact and not a missing feature.
 */
export type AuthFlowReturnToConfig = {
  readonly parkingCookie: {
    readonly name: string;
    /**
     * Long enough to open a verification mail and come back, short enough that
     * an abandoned flow does not resurface days later on an unrelated sign-in.
     */
    readonly maxAgeSeconds: number;
  };
};

export type AuthFlowHostConfig = {
  readonly api: AuthFlowApiConfig;
  readonly routes: AuthFlowRoutes;
  readonly copy: AuthFlowCopy;
  /**
   * The SmartCaptcha site key VALUE, not the env name.
   *
   * Gate §4.2 drafted `botProtection: { siteKeyEnv: string }`; that shape cannot
   * work, because Next inlines `NEXT_PUBLIC_*` only at a LITERAL
   * `process.env.NEXT_PUBLIC_…` read in the app's own source — a package handed
   * an env NAME would read `undefined` in every built host. The host does its own
   * literal read and states the resulting value here. Rewritten in PR 1.3 while
   * the draft is still a draft (nothing runs on it yet), per the inline-rewrite
   * rule.
   */
  readonly botProtection: { readonly siteKey: string | undefined };
  /** The sign-in-code channels this host serves — `['email']` where there is no SMS (row 21). */
  readonly channels: readonly OtpChannel[];
  readonly register: {
    /** Whether the registration form carries the optional promo-code box (row 9). */
    readonly promoField: boolean;
  };
  /** Absent = this host parks nothing (row 29). */
  readonly returnTo?: AuthFlowReturnToConfig;
};
