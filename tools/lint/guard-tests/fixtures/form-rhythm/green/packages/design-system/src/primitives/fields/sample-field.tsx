// Clean field: inline FormMessage only (no reserved slot), neutral label,
// one description id. Honours ADR-0013 §7 — the guard must pass this (exit 0).
export function SampleField({ label }: { label: string }) {
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
