// Fixture: the string-literal blind spot (#1406 Mode-a blocker 1).
//
// The glob `"apps/api/test/**"` embeds a `/*`. A stripper that is not
// string-aware enters block-comment mode here, never finds a terminator, and
// blanks the WHOLE REST OF THE FILE — so the two real physical deletes below
// become a SILENT false negative. The guard must flag both.
const IGNORE = ["apps/api/test/**"];

export class RegistrationsRepository {
  async purge(eventId: string): Promise<void> {
    await this.db.delete(registrations).where(eq(registrations.id, eventId));
    await this.db.execute(sql`DELETE FROM consent_records`);
  }

  ignored(): string[] {
    return IGNORE;
  }
}
