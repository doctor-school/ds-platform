// Fixture: an emitter whose event is NOT documented in any manifest → drift.
export class FooService {
  @OutboxEmit("user.registered")
  register(): void {}
}
