import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Inject,
  Injectable,
  NotFoundException,
  type NestMiddleware,
} from "@nestjs/common";
import { webhookSecretMatches } from "../auth/webhook-secret.js";

/** DI token: the configured `INTERNAL_API_TOKEN`, or `null` when unset (every internal route then 404s). */
export const INTERNAL_API_TOKEN = Symbol("INTERNAL_API_TOKEN");

const BEARER = /^Bearer (.+)$/;

/** Constant-time `Authorization: Bearer <token>` check; an unset token admits nothing. */
export function internalCredentialMatches(
  authorization: string | undefined,
  token: string | null,
): boolean {
  if (!token) return false;
  const presented = authorization ? BEARER.exec(authorization)?.[1] : undefined;
  return webhookSecretMatches(presented, token);
}

/**
 * ADR-0015 §4 req. 2 — the storefront-server-only routes under
 * `INTERNAL_API_PREFIX` exist only for a caller holding the internal
 * credential. Lead decision (#3172): a shared secret, not a network check —
 * a compose address is not an identity. A request without it gets the
 * router's own not-found answer before any guard runs (no rate-limit unit,
 * no 401 / 429 that would reveal the route), so the route is not
 * discoverable. Applied by the sign-in-host module to the internal
 * controller only.
 */
@Injectable()
export class InternalApiMiddleware implements NestMiddleware {
  constructor(
    @Inject(INTERNAL_API_TOKEN) private readonly token: string | null,
  ) {}

  use(req: IncomingMessage, _res: ServerResponse, next: () => void): void {
    const raw = req.headers.authorization;
    if (!internalCredentialMatches(raw, this.token)) {
      throw new NotFoundException(
        `Cannot ${req.method ?? "GET"} ${req.url ?? "/"}`,
      );
    }
    next();
  }
}
