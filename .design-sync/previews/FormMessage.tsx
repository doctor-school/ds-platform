import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Checkbox, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from '@ds/design-system';

export const Invalid = () => {
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

export const Success = () => {
  const form = useForm({ defaultValues: { email: 'anna.smirnova@example.ru' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input data-success="true" {...field} />
              </FormControl>
              <FormMessage success>Адрес подтверждён</FormMessage>
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};

export const OnPrimary = () => {
  const form = useForm({ defaultValues: { consent: false } });
  useEffect(() => {
    form.setError('consent', { type: 'manual', message: 'Подтвердите согласие, чтобы записаться' });
  }, [form]);
  return (
    <div className="bg-primary-surface p-4" style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="consent"
          control={form.control}
          render={() => (
            <FormItem>
              <Checkbox tone="on-primary" aria-invalid="true">
                Согласен на обработку персональных данных
              </Checkbox>
              <FormMessage tone="on-primary" />
            </FormItem>
          )}
        />
      </Form>
    </div>
  );
};
