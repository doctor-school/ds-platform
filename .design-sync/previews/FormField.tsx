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
  NativeSelect,
} from '@ds/design-system';

export const TextField = () => {
  const form = useForm({ defaultValues: { workplace: 'ГКБ № 1, кардиологическое отделение' } });
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()}>
          <FormField
            name="workplace"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Место работы</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormDescription>Укажите учреждение и отделение.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </div>
  );
};

export const SelectWithError = () => {
  const form = useForm({ defaultValues: { specialty: '' } });
  useEffect(() => {
    form.setError('specialty', { type: 'manual', message: 'Выберите специальность' });
  }, [form]);
  return (
    <div style={{ width: 360 }}>
      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()}>
          <FormField
            name="specialty"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Специальность</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="" disabled>
                      Выберите специальность
                    </option>
                    <option value="cardio">Кардиология</option>
                    <option value="neuro">Неврология</option>
                    <option value="endo">Эндокринология</option>
                  </NativeSelect>
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
