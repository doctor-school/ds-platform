import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@ds/design-system';

export const OpenFromTrigger = () => (
  <AlertDialog open>
    <AlertDialogTrigger asChild>
      <Button variant="outline">Отозвать запись</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Отозвать запись?</AlertDialogTitle>
        <AlertDialogDescription>
          Запись перестанет показываться и освободит слот своего вида. Её можно
          будет восстановить — действие обратимо.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Отмена</AlertDialogCancel>
        <AlertDialogAction>Отозвать</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
