/* form-rhythm-ok: third-party widget ships its own reserved-height alert markup */
// A reasoned opt-out suppresses an otherwise-flagged file (exit 0).
export function SampleField({ label }: { label: string }) {
  return (
    <FormItem>
      <FormLabel className="text-destructive">{label}</FormLabel>
      <FormControl>
        <Input />
      </FormControl>
      <FormMessage className="min-h-5" />
    </FormItem>
  );
}
