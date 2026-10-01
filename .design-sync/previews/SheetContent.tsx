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
} from '@ds/design-system';

export const ReadCard = () => (
  <Sheet open>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Заявка №1041</SheetTitle>
        <SheetDescription>↑/↓ — соседняя заявка, Escape или × — закрыть.</SheetDescription>
      </SheetHeader>
      <SheetBody>
        <dl style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)', margin: 0 }}>
          {[
            ['Специальность', 'Терапия'],
            ['Город', 'Казань'],
            ['Статус', 'Подтверждена'],
            ['Источник', 'Форма на сайте конгресса'],
            ['Дни участия', 'Первый и второй день'],
          ].map(([term, value]) => (
            <div key={term} style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 1)' }}>
              <dt style={{ color: 'var(--color-muted-foreground)', fontSize: 14 }}>{term}</dt>
              <dd style={{ margin: 0, color: 'var(--color-foreground)', fontSize: 14 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </SheetBody>
    </SheetContent>
  </Sheet>
);

export const EntryForm = () => (
  <Sheet open>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Новая заявка</SheetTitle>
        <SheetDescription>
          Регистрация участника за стойкой. Поля — в теле, действия — внизу.
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

export const LeftLarge = () => (
  <Sheet open>
    <SheetContent side="left" size="lg">
      <SheetHeader>
        <SheetTitle>Новая заявка</SheetTitle>
        <SheetDescription>
          Регистрация участника за стойкой. Поля — в теле, действия — внизу.
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

export const WithoutCloseButton = () => (
  <Sheet open>
    <SheetContent showCloseButton={false}>
      <SheetHeader>
        <SheetTitle>Заявка №1041</SheetTitle>
        <SheetDescription>↑/↓ — соседняя заявка, Escape или × — закрыть.</SheetDescription>
      </SheetHeader>
      <SheetBody>
        <dl style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)', margin: 0 }}>
          {[
            ['Специальность', 'Терапия'],
            ['Город', 'Казань'],
            ['Статус', 'Подтверждена'],
            ['Источник', 'Форма на сайте конгресса'],
            ['Дни участия', 'Первый и второй день'],
          ].map(([term, value]) => (
            <div key={term} style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 1)' }}>
              <dt style={{ color: 'var(--color-muted-foreground)', fontSize: 14 }}>{term}</dt>
              <dd style={{ margin: 0, color: 'var(--color-foreground)', fontSize: 14 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </SheetBody>
    </SheetContent>
  </Sheet>
);
