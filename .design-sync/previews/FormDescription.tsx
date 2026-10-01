import { useForm } from 'react-hook-form';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@ds/design-system';

export const HelperText = () => {
  const form = useForm({ defaultValues: { snils: '' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="snils"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>СНИЛС</FormLabel>
              <FormControl>
                <Input placeholder="000-000-000 00" {...field} />
              </FormControl>
              <FormDescription>Нужен для передачи баллов НМО на портал edu.rosminzdrav.ru.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};
