import { timingSafeEqual } from "node:crypto";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  SignInHostDoor,
  SignInHostEntryResponse,
  SignInHostStorefront,
} from "@ds/schemas";
import { IDP_CLIENT, type IdpClient, type IdpSession } from "../auth/idp/idp.types.js";
import {
  clearRecordCookie,
  FORM_STATE_TTL_SECONDS,
  formCookie,
  recordCookie,
} from "./sign-in-host.cookies.js";
import type { SignInHostSettings } from "./sign-in-host.config.js";
import { SIGN_IN_HOST_IDP, type SignInHostIdp } from "./sign-in-host.idp.js";
import {
  freshCredentialAsked,
  recordCookieMaxAgeSeconds,
  recordExpiresAt,
  recordVerdict,
  SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
} from "./sign-in-host.policy.js";
import {
  SignInHostRecordStore,
  type SignInHostRecord,
} from "./sign-in-host-record.store.js";
import {
  newOpaqueId,
  resolveEntryIntent,
  SIGN_IN_HOST_STATE_STORE,
  type EntryIntent,
  type FormState,
  type SignInHostStateStore,
} from "./sign-in-host-state.store.js";
import {
  SIGN_IN_HOST_CLOCK,
  SIGN_IN_HOST_SETTINGS,
  type SignInHostClock,
} from "./sign-in-host.tokens.js";

const AUTH_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** One refusal for every form-post check (CSRF, Origin, Sec-Fetch-Site, binding). */
const FORM_REFUSED = "form refused";

/** The request facts the sign-in host decides on — all taken from the browser's own request. */
export interface HostRequest {
  readonly cookies: Readonly<Record<string, string>>;
  readonly fingerprint: string;
}

export interface EntryOutcome {
  readonly body: SignInHostEntryResponse;
  readonly setCookies: string[];
}

export interface StepOutcome {
  readonly url: string;
  readonly setCookies: string[];
}

/** A form post that passed ADR-0015 §4 req. 3: its state and the cookie keying it. */
export interface CheckedForm {
  readonly state: FormState;
  readonly formCookieId: string;
}

/**
 * 003 EARS-5 (amended) / 60 / 64 / 66 / 67 / 68 / 71 — the sign-in host's
 * decisions: what an auth request navigation renders or where it goes, and
 * what a successful credential step does with its session (replace the
 * shared record, finalise the auth request — never a storefront session).
 */
@Injectable()
export class SignInHostService {
  private readonly logger = new Logger(SignInHostService.name);

  constructor(
    @Inject(SIGN_IN_HOST_SETTINGS)
    private readonly settings: SignInHostSettings | null,
    @Inject(SIGN_IN_HOST_IDP) private readonly hostIdp: SignInHostIdp,
    @Inject(SIGN_IN_HOST_STATE_STORE)
    private readonly state: SignInHostStateStore,
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(SIGN_IN_HOST_CLOCK) private readonly clock: SignInHostClock,
    @Inject(SignInHostRecordStore)
    private readonly records: SignInHostRecordStore,
  ) {}

  /** The module is disabled until every sign-in-host key is set: 404, as if the route did not exist. */
  private enabled(): SignInHostSettings {
    if (!this.settings) throw new NotFoundException();
    return this.settings;
  }

  /** The 404 gate alone, for routes whose work is the shared auth surface. */
  assertEnabled(): void {
    this.enabled();
  }

  /**
   * `GET /v1/sign-in-host/entry` — one auth-request navigation.
   */
  async entry(
    authRequest: string | undefined,
    req: HostRequest,
    cookieNames: { record: string; form: string },
  ): Promise<EntryOutcome> {
    const settings = this.enabled();
    const setCookies: string[] = [];
    const priorFormId = req.cookies[cookieNames.form];
    const prior = priorFormId ? await this.state.getForm(priorFormId) : null;
    // EARS-66 / EARS-67: anything that names no live auth request goes back to
    // the storefront this browser's form state recorded — from the fixed map,
    // never a URL parameter — or, with nothing recorded, to the doctor one.
    const back = (): EntryOutcome => ({
      body: {
        action: "redirect",
        url: settings.loginUrls[prior?.storefront ?? "doctor"],
      },
      setCookies,
    });

    if (!authRequest || !AUTH_REQUEST_ID.test(authRequest)) return back();
    const request = await this.hostIdp.readAuthRequest(authRequest);
    if (!request) return back();

    // EARS-60: a client outside the fixed map — the admin client among them —
    // gets `access_denied` and no form; it never touches the record.
    const storefront = settings.clients.get(request.clientId);
    if (!storefront) {
      const url = await this.hostIdp.finaliseWithError(
        request.id,
        "access_denied",
      );
      return {
        body: { action: "redirect", url: url ?? settings.loginUrls.doctor },
        setCookies,
      };
    }

    // EARS-71: the intent is spent on this read whatever happens next.
    const intent = await resolveEntryIntent(
      this.state,
      request.loginHint,
      request.clientId,
    );

    const now = this.clock();
    const live = await this.liveRecord(
      req.cookies[cookieNames.record],
      req.fingerprint,
      now,
      setCookies,
    );

    const door: SignInHostDoor =
      intent?.door ?? (request.prompt.includes("create") ? "register" : "login");
    // A form-only entry — registration, reset, or a hand-off whose reference
    // must never ride someone else's live record (lead decision 2) — and the
    // EARS-68 fresh-credential asks all render the form even with a record.
    const formOnly = door !== "login" || Boolean(intent?.handoff);
    if (
      live &&
      !formOnly &&
      !freshCredentialAsked({
        prompt: request.prompt,
        maxAgeSeconds: request.maxAgeSeconds,
        lastCredentialAt: live.record.lastCredentialAt,
        now,
      })
    ) {
      // EARS-64: a live record answers at once, without a form.
      const url = await this.hostIdp.finaliseWithSession(
        request.id,
        live.record.session,
      );
      if (url) {
        await this.records.touchFinalised(live.cookieId, now);
        return { body: { action: "redirect", url }, setCookies };
      }
      // Zitadel no longer honours the session: the browser is signed out.
      await this.drop(live.cookieId, live.record.session, setCookies);
    }

    // EARS-68: a silent check with no usable record is `login_required`.
    if (request.prompt.includes("none")) {
      const url = await this.hostIdp.finaliseWithError(
        request.id,
        "login_required",
      );
      return {
        body: {
          action: "redirect",
          url: url ?? settings.loginUrls[storefront],
        },
        setCookies,
      };
    }

    // Render: fresh form state under a fresh cookie (req. 3), recording the
    // storefront for a later stale request (EARS-66).
    const formId = newOpaqueId();
    const csrf = newOpaqueId();
    await this.state.putForm(
      formId,
      { csrfToken: csrf, storefront, authRequestId: request.id, intent },
      FORM_STATE_TTL_SECONDS,
    );
    if (priorFormId) await this.state.deleteForm(priorFormId);
    setCookies.push(formCookie(formId));
    return {
      body: {
        action: "render",
        storefront,
        door,
        authRequest: request.id,
        csrf,
        ...(intent ? { intent: publicIntent(intent) } : {}),
      },
      setCookies,
    };
  }

  /**
   * ADR-0015 §4 req. 3 / EARS-70 server half — a form post is honoured only as
   * a same-origin `POST` from the sign-in host: `Origin` equal to the host's
   * own origin, `Sec-Fetch-Site: same-origin` when the browser sends it, and a
   * CSRF token equal to the one bound to the pre-existing form-state cookie for
   * this very auth request. Every miss is the one 403.
   */
  async checkFormPost(input: {
    origin: string | undefined;
    secFetchSite: string | undefined;
    formCookieId: string | undefined;
    csrf: string;
    authRequest: string;
  }): Promise<CheckedForm> {
    const settings = this.enabled();
    if (input.origin !== settings.hostOrigin)
      throw new ForbiddenException(FORM_REFUSED);
    if (input.secFetchSite !== undefined && input.secFetchSite !== "same-origin")
      throw new ForbiddenException(FORM_REFUSED);
    if (!input.formCookieId) throw new ForbiddenException(FORM_REFUSED);
    const state = await this.state.getForm(input.formCookieId);
    if (
      !state ||
      !sameSecret(state.csrfToken, input.csrf) ||
      state.authRequestId !== input.authRequest
    ) {
      throw new ForbiddenException(FORM_REFUSED);
    }
    return { state, formCookieId: input.formCookieId };
  }

  /** The hand-off reference the form's spent intent carried (EARS-44 on the host), if any. */
  handoffOf(form: CheckedForm): string | undefined {
    return form.state.intent?.handoff;
  }

  /**
   * EARS-5 (amended) — what a successful credential step does with its checked
   * session, as the `accept` of the shared `AuthService` steps:
   *
   * 1. give the Zitadel session its explicit 30-day lifetime (fail closed);
   * 2. replace the record: terminate the old Zitadel session, delete its row,
   *    store the new one under a fresh cookie id (req. 5 fixation);
   * 3. finalise the auth request with the new session.
   *
   * No storefront session is minted here; that is the callback's redeem.
   */
  acceptInto(
    form: CheckedForm,
    req: HostRequest,
    recordCookieName: string,
  ): (session: IdpSession) => Promise<StepOutcome> {
    const settings = this.enabled();
    return async (checked) => {
      const session = await this.hostIdp.setSessionLifetime(
        checked,
        SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
      );
      if (!session) {
        await this.idp.terminateSession(checked);
        this.logger.error(
          "sign-in host: the IdP refused the session lifetime; the step fails closed",
        );
        throw new HttpException(
          "sign-in temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const setCookies: string[] = [];
      const priorId = req.cookies[recordCookieName];
      if (priorId) {
        const prior = await this.records.find(priorId);
        if (prior) await this.idp.terminateSession(prior.session);
        await this.records.delete(priorId);
      }
      const now = this.clock();
      const cookieId = newOpaqueId();
      const expiresAt = recordExpiresAt(now);
      await this.records.insert(cookieId, {
        session,
        fingerprint: req.fingerprint,
        lastCredentialAt: now,
        expiresAt,
      });
      setCookies.push(
        recordCookie(cookieId, recordCookieMaxAgeSeconds(expiresAt, now)),
      );
      const url = await this.hostIdp.finaliseWithSession(
        form.state.authRequestId,
        session,
      );
      // EARS-66: the auth request went stale while the person typed — the
      // record stands (they are signed in on the host), the browser goes back
      // to the storefront that started it.
      return {
        url: url ?? settings.loginUrls[form.state.storefront],
        setCookies,
      };
    };
  }

  /** The cookie id and record behind `cookieId`, if it may answer this request. */
  private async liveRecord(
    cookieId: string | undefined,
    fingerprint: string,
    now: Date,
    setCookies: string[],
  ): Promise<{ cookieId: string; record: SignInHostRecord } | null> {
    if (!cookieId) return null;
    const record = await this.records.find(cookieId);
    if (!record) {
      setCookies.push(clearRecordCookie());
      return null;
    }
    if (recordVerdict(record, now, fingerprint) !== "usable") {
      // EARS-64: foreign fingerprint or expired — deleted, its Zitadel session
      // terminated, the browser treated as signed out.
      await this.drop(cookieId, record.session, setCookies);
      return null;
    }
    return { cookieId, record };
  }

  private async drop(
    cookieId: string,
    session: IdpSession,
    setCookies: string[],
  ): Promise<void> {
    await this.idp.terminateSession(session);
    await this.records.delete(cookieId);
    setCookies.push(clearRecordCookie());
  }

  /** The storefront `/login` a refused step falls back to. */
  loginUrlOf(storefront: SignInHostStorefront): string {
    return this.enabled().loginUrls[storefront];
  }
}

function publicIntent(intent: EntryIntent) {
  return {
    ...(intent.method ? { method: intent.method } : {}),
    ...(intent.eventTarget ? { eventTarget: intent.eventTarget } : {}),
    handoff: Boolean(intent.handoff),
  };
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
