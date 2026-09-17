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
 * codec consume. PR 1.5 adds what the sign-in door reads: the landing table
 * (with the remembered-specialty reads named as paths), the event and room route
 * templates, the return-context card flag and the door's copy as plain string
 * templates (the copy crosses the server-mount → client boundary, so it can hold
 * no function), and the shared auth frame's brand assets and panel copy. The
 * consent tiers arrive with PRs 1.6–1.8; a field nothing reads yet would be a
 * claim, not a contract.
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
    /** The sign-in identifier box — email, or email-or-phone where SMS is served. */
    readonly identifier: AuthFlowFieldCopy;
    /** The phone box of the SMS sign-in-code request. */
    readonly phone: AuthFlowFieldCopy;
  };
  /** The sign-in door (rows 33–46). */
  readonly login: AuthFlowLoginCopy;
  /** The brand panel's value prop and closing line in the shared auth frame (row 47). */
  readonly brand: AuthFlowBrandCopy;
  /**
   * 003 EARS-17 — the SmartCaptcha processing notice under the auth card. The
   * frame renders it exactly where `botProtection.siteKey` is set, i.e. wherever
   * the challenge can run, so every host that challenges also discloses.
   */
  readonly botProtectionDisclosure: AuthFlowBotProtectionDisclosureCopy;
  /** The return-context card beside a door (row 46) — present exactly where `returnTo.card`. */
  readonly returnContext?: AuthFlowReturnContextCopy;
};

/** The brand panel's four lines (row 47) — the canvas value prop and the panel footer. */
export type AuthFlowBrandCopy = {
  readonly eyebrow: string;
  readonly headline: string;
  readonly subcopy: string;
  readonly footer: string;
};

/** 003 EARS-17 — the notice sentence, its link text and the link's accessible name. */
export type AuthFlowBotProtectionDisclosureCopy = {
  readonly notice: string;
  readonly link: string;
  readonly linkLabel: string;
};

/**
 * A static vector the host serves from its own `public/` (ADR-0013 §8). The
 * intrinsic size feeds `next/image`; the frame scales the display height.
 */
export type AuthFlowBrandAsset = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
};

/** The brand assets of the shared auth frame (gate §4.2 `brand`, row 47). */
export type AuthFlowBrand = {
  /** The form-column lockup, the one mark below the `layout:` breakpoint. */
  readonly wordmark: AuthFlowBrandAsset & {
    readonly alt: string;
    /**
     * The white lockup for a host whose dark theme paints the page near-black
     * (the doctor storefront, #1955): both render and the class-based `dark:`
     * variant picks one. Absent = this host shows one lockup in every theme.
     */
    readonly darkSrc?: string;
  };
  /** The decorative panel mark on the blue brand panel. */
  readonly panel: AuthFlowBrandAsset;
};

/**
 * Everything the sign-in door says (rows 33–46).
 *
 * Strings only. A sentence that depends on a value is a TEMPLATE with a named
 * `{placeholder}` (`{destination}`, `{seconds}`) the package fills on the client —
 * the config is handed from a server route mount to a client composition, and a
 * function cannot cross that boundary.
 */
export type AuthFlowLoginCopy = {
  readonly title: string;
  readonly description: string;
  readonly createAccount: string;
  readonly forgotPassword: string;
  readonly methodSwitcherLabel: string;
  readonly methodPassword: string;
  readonly methodOtp: string;
  readonly password: {
    readonly formLabel: string;
    readonly identifierLabel: string;
    readonly identifierPlaceholder: string;
    readonly passwordLabel: string;
    /** The empty password box on the sign-in form (the registration sentence differs). */
    readonly passwordRequired: string;
    /** The password-reveal toggle (003 EARS-38); absent = the design-system default. */
    readonly reveal?: {
      readonly show: string;
      readonly hide: string;
      readonly showAria: string;
      readonly hideAria: string;
    };
    readonly submit: string;
  };
  readonly otp: {
    readonly formLabel: string;
    readonly heading: string;
    readonly description: string;
    readonly channelGroupLabel: string;
    readonly channelEmail: string;
    readonly channelSms: string;
    readonly emailLabel: string;
    readonly emailPlaceholder: string;
    readonly phoneLabel: string;
    readonly phonePlaceholder: string;
    readonly sendCode: string;
    readonly verifyTitle: string;
    /** Template with `{destination}` — the block masks the destination. */
    readonly sentTo: string;
    readonly codeLabel: string;
    /** The malformed sign-in code (the registration confirmation sentence differs). */
    readonly codeInvalid: string;
    readonly verifySubmit: string;
    readonly resend: string;
    /** Template with `{seconds}`. */
    readonly resendCountdown: string;
    readonly changeMethod: string;
  };
  /**
   * The per-ACTION generic each call passes to the error dictionary (row 11) —
   * the dictionary carries none, so a failed code never says «войти».
   */
  readonly failed: {
    readonly password: string;
    readonly otpRequest: string;
    readonly otpVerify: string;
  };
};

/** The return-context card's words (row 46): one eyebrow, the door forks only the line. */
export type AuthFlowReturnContextCopy = {
  readonly eyebrow: string;
  /** The sign-in door: the return happens on sign-in. */
  readonly login: string;
  /** The registration door: the return happens after the confirmation. */
  readonly register: string;
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
  /**
   * This host's event page (rows 39, 42). A closed set rather than any string:
   * each template names the ONE strict `@ds/schemas` return-target parser for
   * that shape, so a carried target from the other storefront is never an intent
   * here (019 EARS-12).
   */
  readonly eventPathTemplate: AuthFlowEventPathTemplate;
  /**
   * 006 EARS-6 — this host's room route template (`/webinars/:slug/room`), the
   * same plain value `@ds/room` reads; absent on a host that serves no room.
   */
  readonly room?: string;
};

/** The event-page shapes a host can serve — Academy `/webinars/<slug>`, doctor `/events/<slug>`. */
export type AuthFlowEventPathTemplate = "/webinars/:slug" | "/events/:slug";

/**
 * Where a signed-in visitor lands with no carried target (rows 37, 38, 41).
 *
 * `afterLogin` is the default. A `specialtyAware` host names, as PATHS, the two
 * reads its remembered specialty lives behind and the feed a remembered one
 * lands on; the package server helper does the reading, because a mounted route
 * file may read nothing itself.
 */
export type AuthFlowLandingConfig =
  | { readonly afterLogin: string; readonly specialtyAware: false }
  | {
      readonly afterLogin: string;
      readonly specialtyAware: true;
      /** The feed a remembered specialty lands on (021 EARS-3). */
      readonly specialtyFeed: string;
      readonly specialtyEndpoints: {
        /** The profile read, sent with the session (`/v1/me/specialty`). */
        readonly signedIn: string;
        /** The anonymous-store read (`/v1/public/specialty-choice`). */
        readonly guest: string;
        /** The request header that marks the guest store's consumption as deferred. */
        readonly consumptionDeferredHeader: string;
      };
    };

/**
 * `returnTo` parking (rows 29–31). `undefined` on a host that parks nothing —
 * the doctor storefront carries the target on the canonical query param and has
 * no cookie at all, which is a host fact and not a missing feature.
 */
export type AuthFlowReturnToConfig = {
  /** Absent = this host parks nothing and carries the target on the query param alone. */
  readonly parkingCookie?: {
    readonly name: string;
    /**
     * Long enough to open a verification mail and come back, short enough that
     * an abandoned flow does not resurface days later on an unrelated sign-in.
     */
    readonly maxAgeSeconds: number;
  };
  /** Row 46 — the door publishes the return context as a card beside the form. */
  readonly card?: boolean;
};

export type AuthFlowHostConfig = {
  readonly api: AuthFlowApiConfig;
  readonly routes: AuthFlowRoutes;
  readonly landing: AuthFlowLandingConfig;
  readonly copy: AuthFlowCopy;
  readonly brand: AuthFlowBrand;
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
  /** Absent = no parking and no return-context card (rows 29, 46). */
  readonly returnTo?: AuthFlowReturnToConfig;
};
