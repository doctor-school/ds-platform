import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ds/design-system';

export const FooterCancelOnly = () => (
  <Dialog open>
    <DialogContent showCloseButton={false}>
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

export const WithCloseIcon = () => (
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
