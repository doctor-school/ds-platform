import {
  Button,
  Input,
  Label,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@ds/design-system';

export const OpenFromTrigger = () => (
  <Sheet open>
    <SheetTrigger asChild>
      <Button>Новая заявка</Button>
    </SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Новая заявка</SheetTitle>
        <SheetDescription>
          Регистрация врача за стойкой. Поля — в теле, действия — внизу.
        </SheetDescription>
      </SheetHeader>
      <SheetBody>
        <form id="desk-form" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
            <Label htmlFor="desk-specialty">Специальность</Label>
            <Input id="desk-specialty" defaultValue="Терапия" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
            <Label htmlFor="desk-city">Город</Label>
            <Input id="desk-city" defaultValue="Казань" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
            <Label htmlFor="desk-email">Эл. почта</Label>
            <Input id="desk-email" type="email" placeholder="doctor@example.ru" />
          </div>
        </form>
      </SheetBody>
      <SheetFooter>
        <SheetClose asChild>
          <Button variant="outline">Отмена</Button>
        </SheetClose>
        <Button type="submit" form="desk-form">Сохранить</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);
