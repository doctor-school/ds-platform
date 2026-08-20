// Fixture: NEW physical deletes with no baseline entry — the guard must go red.
// Covers the single-line Drizzle form and the multi-line continuation form.
export class NotesRepository {
  async wipe(id: string): Promise<void> {
    await this.db.delete(notes).where(eq(notes.eventId, id));
    await db
      .delete(noteTags)
      .where(eq(noteTags.eventId, id));
  }
}
