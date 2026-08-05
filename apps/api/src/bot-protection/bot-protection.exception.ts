import { ForbiddenException } from "@nestjs/common";
import {
  BotProtectionErrorCodes,
  type BotProtectionErrorCode,
} from "@ds/schemas";

/**
 * Account-agnostic, machine-readable EARS-17 failure.
 *
 * The code is safe for the portal to branch on: it describes only whether a
 * fresh bot proof is needed/rejected, never an identity or credential outcome.
 * Provider diagnostics remain server-side and are never copied into this body.
 */
export class BotProtectionException extends ForbiddenException {
  constructor(code: BotProtectionErrorCode) {
    super({
      statusCode: 403,
      code,
      message:
        code === BotProtectionErrorCodes.required
          ? "bot-protection challenge required"
          : "bot-protection challenge rejected",
    });
  }
}
