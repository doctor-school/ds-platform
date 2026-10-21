import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { IDP_CLIENT, type IdpClient } from "../auth/idp/idp.types.js";
import {
  SubjectRevocationHub,
  type SubjectRevocationListener,
} from "../auth/session/subject-revocation.js";
import type { SignInHostSettings } from "./sign-in-host.config.js";
import { SIGN_IN_HOST_SESSION_LIFETIME_SECONDS } from "./sign-in-host.policy.js";
import { SignInHostRecordStore } from "./sign-in-host-record.store.js";
import {
  SIGN_IN_HOST_STATE_STORE,
  type SignInHostStateStore,
} from "./sign-in-host-state.store.js";
import {
  SIGN_IN_HOST_CLOCK,
  SIGN_IN_HOST_SETTINGS,
  type SignInHostClock,
} from "./sign-in-host.tokens.js";

/**
 * 003 EARS-12 / EARS-41 — when every session of a subject is revoked (a
 * completed reset, the first accepted code of an unverified account), its
 * sign-in-host records end too: the revocation instant is fenced first (a
 * record whose credential step precedes it is refused on every later use),
 * then every record of the subject is deleted and its Zitadel session
 * terminated. Registered on the auth layer's one {@link SubjectRevocationHub},
 * which runs before the step that asked for the revocation mints its own
 * session — so on the host the fresh record is the only survivor.
 */
@Injectable()
export class SignInHostSubjectRevocation
  implements SubjectRevocationListener, OnModuleInit
{
  private readonly logger = new Logger(SignInHostSubjectRevocation.name);

  constructor(
    @Inject(SubjectRevocationHub) private readonly hub: SubjectRevocationHub,
    @Inject(SIGN_IN_HOST_SETTINGS)
    private readonly settings: SignInHostSettings | null,
    @Inject(SignInHostRecordStore)
    private readonly records: SignInHostRecordStore,
    @Inject(SIGN_IN_HOST_STATE_STORE)
    private readonly state: SignInHostStateStore,
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(SIGN_IN_HOST_CLOCK) private readonly clock: SignInHostClock,
  ) {}

  onModuleInit(): void {
    // A disabled sign-in host holds no records; nothing to end.
    if (this.settings) this.hub.register(this);
  }

  async revokeSubject(sub: string): Promise<void> {
    await this.state.markSubjectRevoked(
      sub,
      this.clock(),
      SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
    );
    for (const session of await this.records.deleteBySubject(sub)) {
      // The row is gone and the fence refuses it anyway; a Zitadel session
      // that will not terminate now still expires on its own lifetime.
      try {
        await this.idp.terminateSession(session);
      } catch (e) {
        this.logger.error(
          `sign-in host: terminating a revoked subject's session failed: ${(e as Error).message}`,
        );
      }
    }
  }
}
