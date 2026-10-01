import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
        <Button variant="outline">Отмена</Button>
        <Button>Прикрепить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
