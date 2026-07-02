// Fixture: an emitter whose event is documented in the manifest → in lockstep.
export class FooService {
  @OutboxEmit("user.registered")
  register(): void {}
}
