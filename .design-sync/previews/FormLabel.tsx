import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from '@ds/design-system';

export const Optional = () => {
  const form = useForm({ defaultValues: { position: '' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="position"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Должность</FormLabel>
              <FormControl>
                <Input placeholder="Врач-кардиолог" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};

export const RequiredInvalid = () => {
  const form = useForm({ defaultValues: { city: '' } });
  useEffect(() => {
    form.setError('city', { type: 'manual', message: 'Укажите город' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="city"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Город</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};
