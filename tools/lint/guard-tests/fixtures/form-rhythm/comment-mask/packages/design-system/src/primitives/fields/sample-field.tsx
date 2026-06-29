// The only violations live in a comment — the live JSX is clean, so the guard
// must NOT raise a false positive (exit 0).
// counter-example: <FormLabel className="text-destructive"> + <FormMessage className="min-h-5" />
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
