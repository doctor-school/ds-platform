import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ds/design-system';

export const OpenFromTrigger = () => (
  <Dialog open>
    <DialogTrigger asChild>
      <Button variant="outline">Прикрепить запись</Button>
    </DialogTrigger>
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
