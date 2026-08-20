// Fixture: in-memory container deletes are NOT physical row removal — must pass.
export class SessionService {
  private readonly bySid = new Map<string, string>();

  drop(sid: string): void {
    this.bySid.delete(sid);
    this.pending.delete(sid);
    headers.delete("authorization");
  }
}
