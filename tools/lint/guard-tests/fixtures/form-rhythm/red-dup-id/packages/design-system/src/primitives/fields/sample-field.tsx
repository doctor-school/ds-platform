// dup-id violation: a separate <FormDescription> rendered alongside <FormMessage>
// — both claim `formDescriptionId` in the resting state (the PasswordField bug).
export function SampleField({ label, hint }: { label: string; hint: string }) {
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input />
      </FormControl>
      <FormDescription>{hint}</FormDescription>
      <FormMessage />
    </FormItem>
  );
}
