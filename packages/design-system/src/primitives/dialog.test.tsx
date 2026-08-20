import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
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
} from "./alert-dialog";

afterEach(cleanup);

/**
 * Close the open modal and wait for the unmount to settle.
 *
 * Not cosmetic: Radix's focus-scope restores focus to the trigger from an
 * unmount `setTimeout` it schedules with no cleanup, so a test that ends with the
 * modal still open leaves that timer to fire after JSDOM teardown — exactly the
 * class the #441 orphan-timer guard fails the suite on. Dismissing inside the test
 * lets the restore run while the environment is still alive.
 */
async function dismiss(
  user: ReturnType<typeof userEvent.setup>,
  role: "dialog" | "alertdialog",
): Promise<void> {
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole(role)).not.toBeInTheDocument());
}

function ConfirmFixture({ onConfirm }: { onConfirm?: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>Снять с публикации</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Снять запись с публикации?</AlertDialogTitle>
          <AlertDialogDescription>
            Запись перестанет показываться на странице мероприятия.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Снять</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 014 EARS-1/EARS-2 (#1339) — the modal element class the recordings panel and
 * #1338's mark-ended command both confirm through (014-design §7).
 *
 * The load-bearing assertions are the ones that separate the two primitives. A
 * confirmation an operator can dismiss by clicking beside it is not a
 * confirmation — the whole point of putting `retire` behind a modal is that the
 * operator ANSWERS. So `AlertDialog` is asserted to keep its `alertdialog` role,
 * survive an outside press, and land initial focus on Cancel; `Dialog` is asserted
 * to do the opposite, because a walk-away surface that traps the operator is its
 * own defect.
 */
describe("014 EARS-2 AlertDialog — a confirmation must be answered", () => {
  it("014 EARS-2: an opened confirmation shall take role=alertdialog and be named + described by its own title and description", async () => {
    const user = userEvent.setup();
    render(<ConfirmFixture />);
    await user.click(screen.getByText("Снять с публикации"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Снять запись с публикации?");
    expect(dialog).toHaveAccessibleDescription(
      "Запись перестанет показываться на странице мероприятия.",
    );
    await dismiss(user, "alertdialog");
  });

  it("014 EARS-2: a press outside the confirmation shall NOT dismiss it — the decision stays on screen", async () => {
    const user = userEvent.setup();
    render(<ConfirmFixture />);
    await user.click(screen.getByText("Снять с публикации"));
    await screen.findByRole("alertdialog");

    // The scrim is what an operator hits when they click "next to" the modal.
    const overlay = document.querySelector(".fixed.inset-0");
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await dismiss(user, "alertdialog");
  });

  it("014 EARS-2: initial focus shall rest on Cancel, so a stray Enter never fires the consequential action", async () => {
    const user = userEvent.setup();
    let confirmed = 0;
    render(<ConfirmFixture onConfirm={() => (confirmed += 1)} />);
    await user.click(screen.getByText("Снять с публикации"));
    await screen.findByRole("alertdialog");

    await waitFor(() => expect(screen.getByText("Отмена")).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(confirmed).toBe(0);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("014 EARS-2: choosing the action shall fire the command exactly once and close the confirmation", async () => {
    const user = userEvent.setup();
    let confirmed = 0;
    render(<ConfirmFixture onConfirm={() => (confirmed += 1)} />);
    await user.click(screen.getByText("Снять с публикации"));
    await screen.findByRole("alertdialog");

    await user.click(screen.getByText("Снять"));
    expect(confirmed).toBe(1);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("014 EARS-2: the action pair shall reuse the Button variants rather than re-declare a look", async () => {
    const user = userEvent.setup();
    render(<ConfirmFixture />);
    await user.click(screen.getByText("Снять с публикации"));
    await screen.findByRole("alertdialog");

    // The raised-button contract: hard 2px border + hover affordance + the flush
    // focus ring, owned once by `buttonVariants`.
    for (const label of ["Отмена", "Снять"]) {
      const control = screen.getByText(label);
      expect(control.className).toMatch(/border-2/);
      expect(control.className).toMatch(/hover:/);
      expect(control.className).toMatch(/focus-visible:shadow-/);
    }
    await dismiss(user, "alertdialog");
  });
});

describe("014 EARS-1 Dialog — the dismissible surface", () => {
  it("014 EARS-1: the dialog shall be dismissible by Escape and expose a named close affordance", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Прикрепить запись</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Прикрепить запись</DialogTitle>
            <DialogDescription>Источник и постер.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button">Сохранить</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByText("Прикрепить запись"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Прикрепить запись");
    // The × is an icon — assistive tech still gets a name.
    expect(screen.getByText("Закрыть")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("014 EARS-1: `showCloseButton={false}` shall drop the × entirely, not merely hide it", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Открыть</DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Без крестика</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByText("Открыть"));
    await screen.findByRole("dialog");
    expect(screen.queryByText("Закрыть")).not.toBeInTheDocument();
    await dismiss(user, "dialog");
  });
});
