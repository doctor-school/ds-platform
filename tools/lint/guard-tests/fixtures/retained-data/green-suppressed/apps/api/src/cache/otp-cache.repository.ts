// Fixture: an ephemeral (non-retained) row with an acknowledged suppression.
export class OtpCacheRepository {
  async consume(key: string): Promise<void> {
    await this.db.delete(otpChallenges).where(eq(otpChallenges.key, key)); // retained-data-ok: single-use OTP challenge, ephemeral by design
  }
}
