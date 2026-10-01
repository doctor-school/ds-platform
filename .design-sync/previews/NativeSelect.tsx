import { Label, NativeSelect } from '@ds/design-system';

const SPECIALTIES = ['Кардиология', 'Неврология', 'Эндокринология', 'Педиатрия', 'Терапия'];

const Options = () => (
  <>
    <option value="" disabled>
      Выберите специальность
    </option>
    {SPECIALTIES.map((s) => (
      <option key={s} value={s}>
        {s}
      </option>
    ))}
  </>
);

export const Empty = () => (
  <div className="flex flex-col gap-2" style={{ width: 320 }}>
    <Label htmlFor="ns-empty" required>
      Специальность
    </Label>
    <NativeSelect id="ns-empty" defaultValue="">
      <Options />
    </NativeSelect>
  </div>
);

export const Filled = () => (
  <div className="flex flex-col gap-2" style={{ width: 320 }}>
    <Label htmlFor="ns-filled" required>
      Специальность
    </Label>
    <NativeSelect id="ns-filled" defaultValue="Кардиология">
      <Options />
    </NativeSelect>
  </div>
);

export const Invalid = () => (
  <div className="flex flex-col gap-2" style={{ width: 320 }}>
    <Label htmlFor="ns-invalid" required>
      Специальность
    </Label>
    <NativeSelect id="ns-invalid" defaultValue="" aria-invalid="true">
      <Options />
    </NativeSelect>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-col gap-2" style={{ width: 320 }}>
    <Label htmlFor="ns-disabled">Специальность</Label>
    <NativeSelect id="ns-disabled" defaultValue="Неврология" disabled>
      <Options />
    </NativeSelect>
  </div>
);
