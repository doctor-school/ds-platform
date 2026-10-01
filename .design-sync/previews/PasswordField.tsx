import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Form, FormField, PasswordField } from '@ds/design-system';

const POLICY = 'Не менее 8 символов, буква и цифра.';

export const NewWithPolicy = () => {
  const form = useForm({ defaultValues: { password: '' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => (
            <PasswordField field={field} purpose="new" label="Пароль" policyHint={POLICY} />
          )}
        />
      </Form>
    </div>
  );
};

export const Current = () => {
  const form = useForm({ defaultValues: { password: 'kardio2026' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => <PasswordField field={field} purpose="current" label="Пароль" />}
        />
      </Form>
    </div>
  );
};

export const Invalid = () => {
  const form = useForm({ defaultValues: { password: 'abc' } });
  useEffect(() => {
    form.setError('password', { type: 'manual', message: 'Пароль слишком короткий' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => (
            <PasswordField field={field} purpose="new" label="Пароль" policyHint={POLICY} />
          )}
        />
      </Form>
    </div>
  );
};
