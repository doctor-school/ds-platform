import { Module } from "@nestjs/common";
import { MeController } from "./me.controller.js";
import { MeRepository } from "./me.repository.js";
import { MeService } from "./me.service.js";

/**
 * 006 self-scoped display-name module (EARS-14, EARS-16; design §11) — the JIT
 * room-entry «Имя и фамилия» write + its owner-only read. It owns no auth
 * primitive (the global `AuthzGuard` + the 003 session enforce the authenticated
 * ∧ `doctor_guest` precondition) and no registration/event surface: its ONLY
 * state is the `users`-mirror `display_name` column, read and written strictly by
 * the caller's own authenticated `sub` through its thin {@link MeRepository} —
 * self-only by construction (no target user id anywhere), so no endpoint exposes
 * another user's name. The display name never flows into chat payloads (chat
 * identity stays the non-PII author tag, owned by the room module).
 */
@Module({
  controllers: [MeController],
  providers: [MeService, MeRepository],
})
export class MeModule {}
