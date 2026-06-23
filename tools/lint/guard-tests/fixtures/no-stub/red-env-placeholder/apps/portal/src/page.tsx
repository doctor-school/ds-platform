// RED: a user-facing dev placeholder leaking to end users — telling the user to
// set an environment variable in place of the real thing.
export function Page() {
  return <main>Please set the STRIPE_KEY environment variable to continue.</main>;
}
