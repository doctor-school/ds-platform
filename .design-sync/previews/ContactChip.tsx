import { ContactChip } from '@ds/design-system';

export const Email = () => (
  <ContactChip
    href="mailto:support@example.ru"
    label="support@example.ru"
    icon={<span className="font-mono text-xs">@</span>}
  />
);

export const Channels = () => (
  <div className="flex flex-wrap items-center gap-3">
    <ContactChip
      href="mailto:support@example.ru"
      label="support@example.ru"
      icon={<span className="font-mono text-xs">@</span>}
    />
    <ContactChip href="tel:+79000000000" label="+7 900 000-00-00" />
    <ContactChip
      href="https://t.me/example"
      label="Telegram"
      icon={<span className="font-mono text-xs">TG</span>}
    />
  </div>
);
