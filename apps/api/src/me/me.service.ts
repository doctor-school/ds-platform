import { Inject, Injectable } from "@nestjs/common";
import type { MyDisplayName } from "@ds/schemas";
import { MeRepository } from "./me.repository.js";

/**
 * The authenticated caller has a valid session `sub` but no 003 `users` mirror
 * row — an authenticated subject that cannot own a display name. HTTP-agnostic so
 * the service stays a pure domain rule; the controller maps it to a 401, never a
 * silent success (EARS-16 fail-closed). `sub` is the unresolved subject.
 */
export class UnknownSubjectError extends Error {
  constructor(readonly sub: string) {
    super(`no user mirror row for subject: ${sub}`);
    this.name = "UnknownSubjectError";
  }
}

/**
 * 006 self-scoped display name (EARS-14, EARS-16; design §11). The SSOT for a
 * doctor's «Имя и фамилия» is the `users`-mirror `display_name` column, collected
 * just-in-time at first room entry (never at registration) via the authed
 * `SetDisplayName` write and read back only by its owner's own session.
 *
 * Self-only by construction: every operation keys strictly on the authenticated
 * caller's `sub` ({@link MeRepository}) — no method takes a target user id, so no
 * endpoint can expose another user's name (EARS-16). The value never flows into a
 * chat payload (chat identity stays the non-PII author tag, owned by the room
 * module) or any other participant-visible surface.
 */
@Injectable()
export class MeService {
  // Explicit `@Inject(Class)` token (not bare paramtype reflection): the class
  // dep appears only in a type position here, which the esbuild/tsx transform
  // elides — leaving `design:paramtypes` undefined and breaking DI in the
  // endpoint-authz gate boot. Naming the token as a value keeps it resolvable.
  constructor(@Inject(MeRepository) private readonly repo: MeRepository) {}

  /**
   * Read the caller's own display name (EARS-16). `displayName` is `null` until
   * the JIT prompt completes. An authenticated subject with no 003 mirror row is
   * refused with {@link UnknownSubjectError} (→ 401), never a fabricated `null`.
   */
  async myDisplayName(sub: string): Promise<MyDisplayName> {
    const row = await this.repo.findDisplayNameBySub(sub);
    if (!row) throw new UnknownSubjectError(sub);
    return { displayName: row.displayName };
  }

  /**
   * Write the caller's own display name (EARS-14). `displayName` arrives already
   * trimmed + bounded by the Zod SSOT (empty / whitespace-only was rejected at
   * the boundary). Idempotent overwrite. Scoped strictly to the caller's row; an
   * authenticated subject with no mirror row is refused (→ 401), never inventing
   * a row. Returns the caller's resulting `MyDisplayName`.
   */
  async setDisplayName(sub: string, displayName: string): Promise<MyDisplayName> {
    const updated = await this.repo.setDisplayNameBySub(sub, displayName);
    if (updated === 0) throw new UnknownSubjectError(sub);
    return { displayName };
  }
}
