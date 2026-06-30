// A type="button" control (resend / change-method) disabled while a submit is in
// flight is NOT an async submit — its disabled state is intentional, not a missing
// progress affordance. The guard must NOT flag it (exit 0).
export function SamplePage({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <form>
      <Button type="button" variant="link" disabled={isSubmitting}>
        Resend
      </Button>
      <Button type="submit" loading={isSubmitting}>
        Submit
      </Button>
    </form>
  );
}
