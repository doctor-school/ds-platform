import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Form, FormField, PhoneField } from '@ds/design-system';

export const Default = () => {
  const form = useForm({ defaultValues: { phone: '+79000000000' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="phone"
          control={form.control}
          render={({ field }) => <PhoneField field={field} label="Телефон" placeholder="+79000000000" />}
        />
      </Form>
    </div>
  );
};

export const Invalid = () => {
  const form = useForm({ defaultValues: { phone: '+7900' } });
  useEffect(() => {
    form.setError('phone', { type: 'manual', message: 'Введите номер в формате +7XXXXXXXXXX' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="phone"
          control={form.control}
          render={({ field }) => <PhoneField field={field} label="Телефон" placeholder="+79000000000" />}
        />
      </Form>
    </div>
  );
};
