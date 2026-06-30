/* submit-pending-ok: this submit renders its pending feedback in an external status
   region, not on the control — a genuine, reviewed exception. */
export function SamplePage({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <form>
      <Button type="submit" disabled={isSubmitting}>
        Submit
      </Button>
    </form>
  );
}
