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
import { ChooseSpecialtyRequestSchema } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";
import {
  readSpecialtyChoiceCookie,
  serializeSpecialtyChoiceCookie,
} from "./specialty-choice.cookie.js";
import { SpecialtyChoiceService } from "./specialty-choice.service.js";

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
   */
  @Post()
  @Public()
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SpecialtyChoice> {
    const parsed = ChooseSpecialtyRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid body");

    const choice = await this.choices.chooseAsGuest(parsed.data.specialty);
    // The RESOLVED entry's id, never the submitted spelling: what the anonymous
    // session holds is then always a reference the book actually served.
    reply.header(
      "set-cookie",
      serializeSpecialtyChoiceCookie(choice.specialty.id),
    );
    return choice;
  }
}
