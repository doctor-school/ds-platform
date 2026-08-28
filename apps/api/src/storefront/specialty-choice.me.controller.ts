import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SpecialtyChoice } from "@ds/schemas";
import {
  ChooseSpecialtyRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { IdempotencyService } from "../taxonomy/idempotency.service.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";
import {
  clearSpecialtyChoiceCookie,
  hasSpecialtyChoiceCookie,
  readSpecialtyChoiceCookie,
} from "./specialty-choice.cookie.js";
import {
  SpecialtyChoiceService,
  UnknownDoctorError,
} from "./specialty-choice.service.js";

/**
 * 017 EARS-6 (#1482) — the AUTHENTICATED half of the choose/change contract
 * (017-design §7 row «choose / change specialty», access column
 * `authenticated`), and the place LD-2's sign-in cascade actually runs.
 *
 * Self-scoped by construction, exactly like `MeController`: the subject is
 * always the session `sub` and no route takes a target user id, so no caller can
 * read or write another doctor's specialty. Classification is
 * `authenticated` / `doctor_guest` / `fast-path` for the same reason — a caller
 * touching only their OWN record needs no policy evaluation, and the global
 * `AuthzGuard` has already refused an unauthenticated caller (401) and any other
 * role (403) before the handler runs.
 *
 * Both routes are per-caller ⇒ `no-store`, never shared-cacheable.
 */
@Controller({ path: "me/specialty", version: "1" })
@UseFilters(SpecialtyProblemFilter)
export class SpecialtyChoiceMeController {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(SpecialtyChoiceService)
    private readonly choices: SpecialtyChoiceService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * `GET /v1/me/specialty` — the doctor's remembered specialty, AND the first
   * authenticated navigation's cascade (017-design §4).
   *
   * The cascade lives on the READ rather than on a dedicated «adopt» call
   * because EARS-6 pins it to «the first authenticated navigation after sign-in
   * or registration», and this read is what the storefront issues while
   * rendering that navigation. A separate endpoint would mean the adoption
   * happened only if a client remembered to call it — a lossless hand-over that
   * depends on the client not forgetting is not lossless.
   *
   * Running it on EVERY authenticated read is safe and deliberate: after the
   * first one there is no session value left to adopt, so the second call takes
   * the profile branch unconditionally. Idempotence, not a one-shot flag.
   */
  @Get()
  @Header("Cache-Control", "no-store")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    // The adoption branch writes a profile link row, and that write is audited
    // by the 010 capture trigger through the repository's `withAuditContext`
    // wrapper — a doctor's targeting changing is an edit to platform data. It is
    // not an auth/security event, so no `AuthAuditLog` emission.
    audit: "low-stakes",
    tests: ["EARS-6"],
  })
  async read(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SpecialtyChoice> {
    const sub = subjectOf(req);
    const sessionCookiePresent = hasSpecialtyChoiceCookie(req.headers.cookie);
    const sessionReference = readSpecialtyChoiceCookie(req.headers.cookie);

    const { choice, consumedSession } = await run(() =>
      this.choices.resolveForDoctor(sub, sessionReference),
    );

    // The discard half of LD-2 — on BOTH branches. Adopted or overruled, the
    // anonymous-session value is gone afterwards, so a later sign-out and
    // sign-in cannot re-adopt a value from before this doctor had a profile.
    if (
      consumedSession ||
      (sessionCookiePresent && sessionReference === null)
    ) {
      reply.header("set-cookie", clearSpecialtyChoiceCookie());
    }
    return choice;
  }

  /**
   * `PUT /v1/me/specialty` — the doctor `ChooseSpecialty` command.
   *
   * `PUT` because the doctor has exactly ONE primary specialty (LD-1) and the
   * command sets it: the resource is «my specialty», re-choosing replaces it,
   * and the same request repeated leaves the same state — the idempotence
   * 017-design §7 names, expressed by the verb rather than promised in prose.
   *
   * The anonymous-session cookie is cleared here too: once the profile holds a
   * choice, a guest value still sitting on this device could only ever be a
   * stale one, and LD-2's «profile wins» would discard it on the next read
   * anyway. Clearing it now means the discard is not deferred to a navigation
   * that may not come.
   */
  @Put()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    // A self-scoped profile write, audited by the 010 capture trigger. Not an
    // auth/security event — a specialty is not a credential and gates nothing.
    audit: "low-stakes",
    tests: ["EARS-6", "EARS-7"],
  })
  async choose(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SpecialtyChoice> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const parsed = ChooseSpecialtyRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid body");

    const sub = subjectOf(req);
    const outcome = await this.idempotency.begin({
      key,
      scope: "storefront.specialty-choice",
      actorId: sub,
      method: "PUT",
      route: "/v1/me/specialty",
      fingerprint: this.idempotency.fingerprint({
        method: "PUT",
        path: "/v1/me/specialty",
        payload: parsed.data,
      }),
    });
    if (outcome.kind === "replay") {
      reply.header("set-cookie", clearSpecialtyChoiceCookie());
      return outcome.replay.body as SpecialtyChoice;
    }
    const choice = await run(() =>
      this.choices.chooseAsDoctor(sub, parsed.data.specialty, outcome.lease),
    );
    reply.header("set-cookie", clearSpecialtyChoiceCookie());
    return choice;
  }
}

/**
 * The acting doctor's Zitadel `sub`. The `AuthzGuard` has already refused an
 * unauthenticated caller; a null `sub` here is fail-closed defence in depth →
 * 401, never a silent success (the `MeController` rule, applied to the same
 * class of self-scoped route).
 */
function subjectOf(req: FastifyRequest): string {
  const sub = (req as { user?: { sub?: string } }).user?.sub;
  if (!sub) throw new UnauthorizedException("authentication required");
  return sub;
}

/**
 * Map «the token's subject has no 003 mirror row» onto the same generic 401 the
 * sibling self-scoped surfaces answer with — the caller learns that they are not
 * authenticated for this, and nothing about which subjects the platform mirrors.
 */
async function run<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof UnknownDoctorError) {
      throw new UnauthorizedException("authentication required");
    }
    throw err;
  }
}
