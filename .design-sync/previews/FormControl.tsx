import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input, Textarea } from '@ds/design-system';

export const WrapsInput = () => {
  const form = useForm({ defaultValues: { email: 'anna@clinic' } });
  useEffect(() => {
    form.setError('email', { type: 'manual', message: 'Неверный формат e-mail' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Email</FormLabel>
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

export const WrapsTextarea = () => {
  const form = useForm({
    defaultValues: { question: 'Какие схемы антикоагулянтной терапии обсуждаются в программе?' },
  });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="question"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Вопрос спикеру</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};
