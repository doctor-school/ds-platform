// Defect: a type="submit" control disabled by the in-flight flag with NO `loading` —
// a static disabled button that reads as hung (#337). The guard must flag this (exit 1).
export function SamplePage({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <form>
      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting}
        data-testid="sample-submit"
      >
        Submit
      </Button>
    </form>
  );
}
