// Fixture: the physical delete below is recorded in the fixture baseline.
export class EventsRepository {
  async replaceSpeakers(id: string): Promise<void> {
    await tx.delete(eventSpeakers).where(eq(eventSpeakers.eventId, id));
  }
}
