// K-1 violation: the message reserves a permanent blank line (`min-h-5`) under a
// resting field — the slice-B over-spacing the #333 redo removed.
export function SampleField({ label }: { label: string }) {
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input />
      </FormControl>
      <FormMessage className="min-h-5" />
    </FormItem>
  );
}
