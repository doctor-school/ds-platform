import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Form, FormField, IdentifierField } from '@ds/design-system';

export const Default = () => {
  const form = useForm({ defaultValues: { identifier: '' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="identifier"
          control={form.control}
          render={({ field }) => (
            <IdentifierField field={field} label="Email или телефон" placeholder="doctor@example.ru" />
          )}
        />
      </Form>
    </div>
  );
};

export const Invalid = () => {
  const form = useForm({ defaultValues: { identifier: 'anna' } });
  useEffect(() => {
    form.setError('identifier', { type: 'manual', message: 'Введите email или номер телефона' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="identifier"
          control={form.control}
          render={({ field }) => (
            <IdentifierField field={field} label="Email или телефон" placeholder="doctor@example.ru" />
          )}
        />
      </Form>
    </div>
  );
};
