// K-3 violation: the label turns destructive-red on error ("red mush"). The
// settled rule keeps the label neutral and marks the field via border + message.
export function SampleField({ label }: { label: string }) {
  return (
    <FormItem>
      <FormLabel className="text-destructive">{label}</FormLabel>
      <FormControl>
        <Input />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
