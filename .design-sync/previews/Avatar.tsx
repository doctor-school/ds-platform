import { Avatar } from '@ds/design-system';

export const Default = () => <Avatar>АС</Avatar>;

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-4">
    <Avatar variant="default">АС</Avatar>
    <Avatar variant="tint">МВ</Avatar>
  </div>
);

export const OnHeader = () => (
  <div className="flex items-center gap-3 bg-header p-4">
    <Avatar variant="header">ЕК</Avatar>
  </div>
);
