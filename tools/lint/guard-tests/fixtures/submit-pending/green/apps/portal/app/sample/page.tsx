// Clean submit: drives the shared Button pending affordance from the in-flight flag.
// Honours ADR-0013 §7 — the guard must pass this (exit 0).
export function SamplePage({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <form>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Submit
      </Button>
    </form>
  );
}
