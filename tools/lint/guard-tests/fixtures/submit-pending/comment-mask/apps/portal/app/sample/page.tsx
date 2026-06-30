// The only "violation" here lives in a comment — a migration note showing the OLD
// wiring. The guard strips comments first, so this must NOT trip it (exit 0).
//
//   <Button type="submit" disabled={isSubmitting}>Submit</Button>   ← the old defect
//
export function SamplePage({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <form>
      <Button type="submit" loading={isSubmitting}>
        Submit
      </Button>
    </form>
  );
}
