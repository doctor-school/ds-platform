import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@ds/design-system';

export const Open = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Прикрепить запись</DialogTitle>
        <DialogDescription>
          Провайдер и идентификатор встраивания. Форму можно закрыть, ничего не
          выбрав — Escape, крестик или клик вне окна.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Отмена</Button>
        </DialogClose>
        <Button>Прикрепить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const WithForm = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Добавить спикера</DialogTitle>
        <DialogDescription>
          Спикер появится в карточке вебинара после сохранения.
        </DialogDescription>
      </DialogHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
          <Label htmlFor="speaker-name">ФИО спикера</Label>
          <Input id="speaker-name" defaultValue="Иванова Мария Петровна" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
          <Label htmlFor="speaker-role">Регалии</Label>
          <Input id="speaker-role" defaultValue="к.м.н., врач-кардиолог" />
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Отмена</Button>
        </DialogClose>
        <Button>Сохранить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
