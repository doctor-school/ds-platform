// Fixture: a service with NO @OutboxEmit — represents "no event contract inputs".
export class FooService {
  doThing(): string {
    return "no events here";
  }
}
