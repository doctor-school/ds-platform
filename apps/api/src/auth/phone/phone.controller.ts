import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  ConfirmPhoneResponse,
  RequestPhoneCodeResponse,
} from "@ds/schemas";
import { Authz } from "../../authz/index.js";
import type { Role } from "../../authz/authz.types.js";
import {
  ConsumedIpWindow,
  RateLimited,
  RateLimitService,
} from "../rate-limit/index.js";
import { TimingEqualized } from "../timing/index.js";
import { ConfirmPhoneRequestDto, RequestPhoneCodeRequestDto } from "./phone.dto.js";
import {
  phoneAccountLimitKey,
  PhoneConfirmationService,
} from "./phone-confirmation.service.js";

/** The account surface's principals (003 EARS-27 as amended by #2456). */
const ACCOUNT_ROLES: Role[] = ["doctor_guest", "platform_admin"];

/**
 * 003 EARS-51: the code request answers a number confirmed on another account
 * exactly like a free one, though that branch skips both IdP calls. The floor
 * sits above the IdP-bound branch (a user read plus a phone write) so the two
 * are indistinguishable by latency (EARS-16).
 */
export const PHONE_CODE_REQUEST_TIMING_FLOOR_MS = 1000;

/**
 * 003 EARS-47…52 (#2449): confirming a phone from `/account`.
 *
 * - `POST /v1/me/phone` → request (or re-send) a confirmation code to a number.
 * - `POST /v1/me/phone/confirm` → submit the code; on success the number is the
 *   account's confirmed phone.
 *
 * `authenticated` / `fast-path` / self-only by the session `sub` (no target
 * id anywhere). Both are sending/verification doors of EARS-13 (the request
 * consumes the sending-door per-IP window; a successful confirm gives back its
 * own verification-door unit) and `audit: high-stakes` (EARS-57).
 */
@Controller({ path: "me/phone", version: "1" })
export class PhoneController {
  constructor(
    private readonly phones: PhoneConfirmationService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @HttpCode(200)
  @RateLimited({ door: "sending" })
  @TimingEqualized({ floorMs: PHONE_CODE_REQUEST_TIMING_FLOOR_MS })
  @Authz({
    access: "authenticated",
    roles: ACCOUNT_ROLES,
    check: "fast-path",
    audit: "high-stakes",
    tests: ["EARS-47", "EARS-49", "EARS-51", "EARS-57"],
  })
  request(
    @Body() dto: RequestPhoneCodeRequestDto,
    @Ip() ip: string,
    @Headers("x-asn") asn: string | undefined,
    @Req() req: { user?: { sub?: string } },
  ): Promise<RequestPhoneCodeResponse> {
    return this.phones.requestCode(subjectOf(req), dto.phone, { ip, asn });
  }

  @Post("confirm")
  @HttpCode(200)
  @RateLimited()
  @Authz({
    access: "authenticated",
    roles: ACCOUNT_ROLES,
    check: "fast-path",
    audit: "high-stakes",
    tests: ["EARS-48", "EARS-52", "EARS-57"],
  })
  async confirm(
    @Body() dto: ConfirmPhoneRequestDto,
    @Ip() ip: string,
    @ConsumedIpWindow() consumedIpWindow: number | undefined,
    @Req() req: { user?: { sub?: string } },
  ): Promise<ConfirmPhoneResponse> {
    const sub = subjectOf(req);
    const result = await this.phones.confirm(sub, dto.code);
    // EARS-13: a success forgives the account's per-user window and (#2684)
    // gives back this verification door's own per-IP unit.
    this.rateLimit.reset({ ip, identifier: phoneAccountLimitKey(sub) });
    this.rateLimit.refundIpUnit(ip, consumedIpWindow);
    return result;
  }
}

/** The session subject; the global AuthzGuard already refused anonymity. */
function subjectOf(req: { user?: { sub?: string } }): string {
  const sub = req.user?.sub;
  if (!sub) throw new UnauthorizedException("authentication required");
  return sub;
}
