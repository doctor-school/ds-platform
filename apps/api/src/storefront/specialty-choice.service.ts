import { Inject, Injectable } from "@nestjs/common";
import type { SpecialtyChoice, SpecialtyRef } from "@ds/schemas";
import { SpecialtiesService } from "./specialties.service.js";
import { SpecialtyChoiceRepository } from "./specialty-choice.repository.js";

/**
 * 017 EARS-6 (#1482) — `ChooseSpecialty` and the sign-in cascade of 017-design
 * §4, as ONE command with an actor-resolved store.
 *
 * Both actors run the same three steps in the same order: resolve the reference
 * against the closed book, record it, answer with what is now remembered. Only
 * the STORE differs — the profile link row for an authenticated doctor, the
 * anonymous session for a guest — and the store is decided by the request, never
 * by the body. That is what makes «a guest cannot write a doctor's choice» a
 * property of the shape rather than of a check someone has to remember.
 *
 * Membership is decided FIRST, always, through `SpecialtiesService.resolveMember`
 * (EARS-3's fail-closed mechanism) — this service owns no second membership rule
 * and never resolves a reference by shape.
 */

/** The acting subject has no 003 mirror row — there is no profile to write. */
export class UnknownDoctorError extends Error {
  constructor() {
    super("unknown doctor subject");
    this.name = "UnknownDoctorError";
  }
}

@Injectable()
export class SpecialtyChoiceService {
  constructor(
    @Inject(SpecialtiesService)
    private readonly specialties: SpecialtiesService,
    @Inject(SpecialtyChoiceRepository)
    private readonly choices: SpecialtyChoiceRepository,
  ) {}

  /**
   * A GUEST chooses (017-design §4, first exchange). The reference is resolved
   * against the book — a non-member is refused with `SPECIALTY_NOT_IN_BOOK`
   * (422) exactly as it is for a doctor, because the book is closed for everyone
   * — and the resolved entry is handed back for the controller to write into the
   * anonymous-session cookie.
   *
   * «Другое» resolves like any other entry (LD-5): it is a real member, so
   * nothing here special-cases it, and the storefront's general-selection
   * behaviour is a consequence of WHICH entry was remembered, not of a separate
   * «no choice» state.
   */
  async chooseAsGuest(
    reference: string,
  ): Promise<SpecialtyChoice & { specialty: SpecialtyRef }> {
    const specialty = await this.specialties.resolveMember(reference);
    return { specialty, storedIn: "session" };
  }

  /**
   * An authenticated DOCTOR chooses. Same command, profile store.
   *
   * Idempotent: re-choosing the standing specialty is a no-op in the repository
   * and answers with the same body, so the storefront needs no «did it change?»
   * branch and a doubled request cannot produce a doubled write.
   */
  async chooseAsDoctor(
    sub: string,
    reference: string,
  ): Promise<SpecialtyChoice> {
    const specialty = await this.specialties.resolveMember(reference);
    const doctorId = await this.requireDoctorId(sub);
    await this.choices.setPrimary(sub, doctorId, specialty.id);
    return { specialty, storedIn: "profile" };
  }

  /**
   * What a GUEST is currently remembered as having chosen.
   *
   * A reference the cookie carries but the book no longer serves resolves to
   * «nothing chosen» rather than to an error: the book is re-seeded when a
   * nomenclature order changes, and a visitor holding a cookie from before an
   * amendment must be shown the catalog again, not a 422 on a page render.
   */
  async readGuestChoice(
    sessionReference: string | null,
  ): Promise<SpecialtyChoice> {
    const specialty = await this.resolveOrForget(sessionReference);
    return specialty
      ? { specialty, storedIn: "session" }
      : { specialty: null, storedIn: "none" };
  }

  /**
   * LD-2's cascade, run on the FIRST authenticated navigation (and harmlessly on
   * every one after it): **adopt if empty, profile wins otherwise, never ask,
   * never merge, never carry across devices.**
   *
   * The two branches differ in exactly one thing — whether the session value is
   * written to the profile before it is discarded — and the discard happens on
   * BOTH, which is what stops a stale guest value from re-adopting itself after a
   * later sign-out and sign-in. `adopted` tells the controller to clear the
   * anonymous-session cookie; it is `true` whenever a session value was present,
   * consumed or not, precisely because both branches consume it.
   *
   * Nothing is prompted and nothing is queued: a doctor whose profile already
   * holds a specialty never learns that this browser once picked another one,
   * because being asked to resolve a conflict they did not know they had is the
   * outcome LD-2 exists to prevent.
   */
  async resolveForDoctor(
    sub: string,
    sessionReference: string | null,
  ): Promise<{ choice: SpecialtyChoice; consumedSession: boolean }> {
    const doctorId = await this.requireDoctorId(sub);
    const onProfile = await this.choices.findPrimary(doctorId);

    if (onProfile) {
      // Profile wins. The session value — if any — is discarded unread.
      return {
        choice: { specialty: onProfile, storedIn: "profile" },
        consumedSession: sessionReference !== null,
      };
    }

    const fromSession = await this.resolveOrForget(sessionReference);
    if (!fromSession) {
      return {
        choice: { specialty: null, storedIn: "none" },
        consumedSession: sessionReference !== null,
      };
    }

    await this.choices.setPrimary(sub, doctorId, fromSession.id);
    return {
      choice: { specialty: fromSession, storedIn: "profile" },
      consumedSession: true,
    };
  }

  /**
   * Resolve a reference held in the anonymous session, or `null` when it names
   * no member. Shared by the guest read and the adoption branch so that a
   * cookie the closed book no longer recognises is forgotten by ONE rule — and
   * in particular can never be adopted onto a profile.
   */
  private async resolveOrForget(
    reference: string | null,
  ): Promise<SpecialtyRef | null> {
    if (!reference) return null;
    try {
      return await this.specialties.resolveMember(reference);
    } catch {
      return null;
    }
  }

  private async requireDoctorId(sub: string): Promise<string> {
    const doctorId = await this.choices.findDoctorIdBySub(sub);
    if (!doctorId) throw new UnknownDoctorError();
    return doctorId;
  }
}
