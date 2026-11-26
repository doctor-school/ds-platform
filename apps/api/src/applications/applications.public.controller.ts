import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  InvestorRequestIntakeResultSchema,
  InvestorRequestIntakeSchema,
  type InvestorRequestIntakeResult,
  PartnershipRequestIntakeResultSchema,
  PartnershipRequestIntakeSchema,
  type PartnershipRequestIntakeResult,
} from "@ds/schemas";

import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { ApplicationRefusalDto } from "./applications.me.controller.js";
import { ApplicationsInvestorService } from "./applications.investor.service.js";
import { ApplicationsPartnershipService } from "./applications.partnership.service.js";
import { ApplicationsService } from "./applications.service.js";

export class PartnershipRequestIntakeDto extends createZodDto(
  PartnershipRequestIntakeSchema,
) {}
export class PartnershipRequestIntakeResultDto extends createZodDto(
  PartnershipRequestIntakeResultSchema,
) {}

export class InvestorRequestIntakeDto extends createZodDto(
  InvestorRequestIntakeSchema,
) {}
export class InvestorRequestIntakeResultDto extends createZodDto(
  InvestorRequestIntakeResultSchema,
) {}

/**
 * 033 EARS-18 — the guest intakes of the shared application queue,
 * `/v1/public/applications/*` (033-design «Endpoints»): the Academy home's
 * partnership form and 034's «Инвесторам» form.
 *
 * Unauthenticated by design — neither form has an account behind it — so the
 * 003 proof is the abuse gate, one action per door:
 * `@BotProtected("partnership")`, `@BotProtected("investor-request")`. The write is `low-stakes`: the 010 capture
 * trigger audits it in the request's context with the queue's PD columns
 * masked (EARS-25). Per-request answer ⇒ `no-store`.
 */
@Controller({ path: "public/applications", version: "1" })
export class ApplicationsPublicController {
  constructor(
    @Inject(ApplicationsService)
    private readonly applications: ApplicationsService,
    @Inject(ApplicationsPartnershipService)
    private readonly partnership: ApplicationsPartnershipService,
    @Inject(ApplicationsInvestorService)
    private readonly investor: ApplicationsInvestorService,
  ) {}

  /** EARS-18 — submit a partnership request; replay-safe per key. */
  @Post("partnership")
  @Public()
  @BotProtected("partnership")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  @ApiCreatedResponse({ type: PartnershipRequestIntakeResultDto })
  @ApiBadRequestResponse({ type: ApplicationRefusalDto })
  @ApiUnprocessableEntityResponse({ type: ApplicationRefusalDto })
  @Authz({
    access: "public",
    check: "none",
    audit: "low-stakes",
    tests: ["EARS-18"],
  })
  async submitPartnership(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: PartnershipRequestIntakeDto,
  ): Promise<PartnershipRequestIntakeResult> {
    const key = this.applications.requireKey(idempotencyKey);
    return this.partnership.submit(key, body);
  }

  /** 034 EARS-6 — submit an investor request; replay-safe per key. */
  @Post("investor")
  @Public()
  @BotProtected("investor-request")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  @ApiCreatedResponse({ type: InvestorRequestIntakeResultDto })
  @ApiBadRequestResponse({ type: ApplicationRefusalDto })
  @ApiUnprocessableEntityResponse({ type: ApplicationRefusalDto })
  @Authz({
    access: "public",
    check: "none",
    audit: "low-stakes",
    tests: ["EARS-6"],
  })
  async submitInvestor(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: InvestorRequestIntakeDto,
  ): Promise<InvestorRequestIntakeResult> {
    const key = this.applications.requireKey(idempotencyKey);
    return this.investor.submit(key, body);
  }
}
