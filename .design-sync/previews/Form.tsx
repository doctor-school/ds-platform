import { useEffect } from 'react';
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

export const ProfileField = () => {
  const form = useForm({ defaultValues: { display: 'Д-р Анна Смирнова' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()}>
          <FormField
            name="display"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Имя в профиле</FormLabel>
                <FormControl>
                  <Input placeholder="Д-р Анна Смирнова" {...field} />
                </FormControl>
                <FormDescription>Видно участникам вебинаров и в сертификате НМО.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </div>
  );
};

export const InvalidField = () => {
  const form = useForm({ defaultValues: { email: 'anna@clinic' } });
  useEffect(() => {
    form.setError('email', { type: 'manual', message: 'Неверный формат e-mail' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()}>
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
        </form>
      </Form>
    </div>
  );
};
