import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Form, FormField, OtpField } from '@ds/design-system';

export const Slotted = () => {
  const form = useForm({ defaultValues: { code: 'PV3' } });
  return (
    <div style={{ width: 400 }}>
      <Form {...form}>
        <FormField
          name="code"
          control={form.control}
          render={({ field }) => (
            <OtpField field={field} length={6} variant="slotted" charset="alphanumeric" label="Код из письма" />
          )}
        />
      </Form>
    </div>
  );
};

export const SlottedInvalid = () => {
  const form = useForm({ defaultValues: { code: 'PVDC3R' } });
  useEffect(() => {
    form.setError('code', { type: 'manual', message: 'Неверный код. Проверьте письмо и попробуйте ещё раз.' });
  }, [form]);
  return (
    <div style={{ width: 400 }}>
      <Form {...form}>
        <FormField
          name="code"
          control={form.control}
          render={({ field }) => (
            <OtpField field={field} length={6} variant="slotted" charset="alphanumeric" label="Код из письма" />
          )}
        />
      </Form>
    </div>
  );
};

export const Plain = () => {
  const form = useForm({ defaultValues: { code: '' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="code"
          control={form.control}
          render={({ field }) => (
            <OtpField
              field={field}
              length={8}
              variant="plain"
              charset="numeric"
              label="Код для входа"
              placeholder="12345678"
            />
          )}
        />
      </Form>
    </div>
  );
};
