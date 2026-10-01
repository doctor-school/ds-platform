import { Input, Label } from '@ds/design-system';

export const Default = () => (
  <div className="flex flex-col gap-2" style={{ width: 320 }}>
    <Label htmlFor="label-default">Место работы</Label>
    <Input id="label-default" placeholder="ГКБ № 1, кардиологическое отделение" />
  </div>
);

export const Required = () => (
  <div className="flex flex-col gap-2" style={{ width: 320 }}>
    <Label htmlFor="label-required" required>
      Email
    </Label>
    <Input id="label-required" defaultValue="doctor@example.ru" />
  </div>
);
