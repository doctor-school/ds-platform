import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SpecialtyChoice } from "@ds/schemas";
import {
  ChooseSpecialtyRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  SpecialtyChoiceSchema,
} from "@ds/schemas";
import type { DrizzleHandle } from "@ds/db";
import { Authz, Public } from "../authz/index.js";
import { RateLimited } from "../auth/rate-limit/index.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { IdempotencyService } from "../taxonomy/idempotency.service.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";
import {
  readSpecialtyChoiceCookie,
  serializeSpecialtyChoiceCookie,
} from "./specialty-choice.cookie.js";
import { SpecialtyChoiceService } from "./specialty-choice.service.js";
import {
  applySpecialtyChoiceReplay,
  isSuccessfulReplay,
} from "./specialty-choice.replay.js";

/**
 * 017 EARS-6 (#1482) — the GUEST half of the choose/change contract
 * (017-design §7 row «choose / change specialty», access column `public`).
 *
 * `@Public()` because a visitor with no account is the actor this pair exists
 * for: EARS-6 requires a guest's choice to be remembered, and requiring a
 * session to record it would make «choose a specialty» a sign-in wall — exactly
 * the gate EARS-4 forbids one section higher on the same page.
 *
 * The store is the anonymous-session cookie (`specialty-choice.cookie.ts`), and
 * both routes are per-caller: `no-store`, never shared-cacheable. That is not a
 * performance choice — a shared cache holding one visitor's remembered specialty
 * would serve it to the next.
 *
 * The guest routes are DELIBERATELY unaware of authentication. A signed-in
 * doctor's storefront calls the `me/specialty` pair instead; if one ever reached
 * here, the worst outcome is a value written to a cookie that the very next
 * authenticated navigation discards under LD-2 — never a write to anybody's
 * profile, because no profile path exists in this file.
 */
@Controller({ path: "public/specialty-choice", version: "1" })
@UseFilters(SpecialtyProblemFilter)
export class SpecialtyChoicePublicController {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(SpecialtyChoiceService)
    private readonly choices: SpecialtyChoiceService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleHandle["db"],
  ) {}

  /**
   * `GET /v1/public/specialty-choice` — what this browser is remembered as
   * having chosen, so the storefront can open the targeted view directly on a
   * return visit (EARS-6) and render the collapsed row rather than the catalog
   * (EARS-7).
   *
   * `{ specialty: null, storedIn: "none" }` for a browser that has not chosen —
   * a first-class answer, not a 404: «no choice yet» is the state the full
   * variant-Б catalog renders for.
   */
  @Get()
  @Public()
  @Header("Cache-Control", "no-store")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-6"],
  })
  read(@Req() req: FastifyRequest): Promise<SpecialtyChoice> {
    return this.choices.readGuestChoice(
      readSpecialtyChoiceCookie(req.headers.cookie),
    );
  }

  /**
   * `POST /v1/public/specialty-choice` — the guest `ChooseSpecialty` command.
   *
   * 200 rather than 201: the command does not create an addressable resource,
   * it records the one choice this anonymous session holds, and re-choosing
   * replaces it (idempotent per 017-design §7). A non-member reference is
   * refused with `SPECIALTY_NOT_IN_BOOK` (422) through the shared problem
   * filter, before any cookie is written — so a refused choice leaves the
   * previously remembered one standing rather than clearing it.
   *
   * `@RateLimited()` (#1646, audit D2 of #1639) because this is an
   * unauthenticated WRITE: every accepted call inserts an `idempotency_keys`
   * row keyed by a client-supplied header, and the TTL sweep soft-expires those
   * rows rather than removing them — so an unbounded anonymous caller is
   * unbounded row growth, not merely wasted work. The decorator carries no
   * per-endpoint value on purpose: the shared EARS-13 windows
   * (`rate-limit.types.ts`) are the platform's one abuse budget, and a body with
   * no `email`/`phone` field engages the per-IP (20 / 15 min) and per-ASN
   * (100 / h) dimensions only — there is no submitted identifier here to key a
   * per-user window on. Neither `@TimingEqualized()` nor `@BotProtected()`
   * applies: the route enumerates nothing and discloses no account existence.
   */
  @Post()
  @Public()
  @RateLimited()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Authz({
    access: "public",
    check: "none",
    // No ledger row: nothing about an anonymous browser's own view preference is
    // an attributable edit to platform data — there is no actor to attribute it
    // to and no row to attribute it against. The profile write, which IS a data
    // edit, is audited at its own route.
    audit: "none",
    tests: ["EARS-6"],
  })
  async choose(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const parsed = ChooseSpecialtyRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid body");

    const outcome = await this.idempotency.begin({
      key,
      scope: "storefront.specialty-choice",
      actorId: null,
      method: "POST",
      route: "/v1/public/specialty-choice",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: "/v1/public/specialty-choice",
        payload: parsed.data,
      }),
    });
    if (applySpecialtyChoiceReplay(outcome, reply)) {
      if (isSuccessfulReplay(outcome)) {
        setChoiceCookie(
          reply,
          SpecialtyChoiceSchema.parse(outcome.replay.body),
        );
      }
      return outcome.replay.body;
    }

    const choice = await this.choices.chooseAsGuest(
      parsed.data.specialty,
      outcome.lease,
    );
    await this.idempotency.complete(this.db, outcome.lease, {
      status: 200,
      body: choice,
    });
    setChoiceCookie(reply, choice);
    return choice;
  }
}

function setChoiceCookie(reply: FastifyReply, choice: SpecialtyChoice): void {
  if (!choice.specialty) return;
  reply.header(
    "set-cookie",
    serializeSpecialtyChoiceCookie(choice.specialty.id),
  );
}
