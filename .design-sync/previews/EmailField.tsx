import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { EmailField, Form, FormField } from '@ds/design-system';

export const Default = () => {
  const form = useForm({ defaultValues: { email: '' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => <EmailField field={field} label="Email" placeholder="doctor@example.ru" />}
        />
      </Form>
    </div>
  );
};

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
          render={({ field }) => <EmailField field={field} label="Email" placeholder="doctor@example.ru" />}
        />
      </Form>
    </div>
  );
};
