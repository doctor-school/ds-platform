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

export const StackedItems = () => {
  const form = useForm({ defaultValues: { lastName: 'Смирнова', firstName: 'Анна' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <FormField
            name="lastName"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Фамилия</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="firstName"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Имя</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormDescription>Как в дипломе — попадёт в сертификат НМО.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </div>
  );
};
