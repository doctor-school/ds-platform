/** One cleanup failure must not strand the other owned resources. */
export async function closeCongressResources(
  steps: readonly (() => unknown | Promise<unknown>)[],
  initial: readonly unknown[] = [],
): Promise<void> {
  const failures: unknown[] = [...initial];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Congress fixture startup/cleanup failed",
    );
}
