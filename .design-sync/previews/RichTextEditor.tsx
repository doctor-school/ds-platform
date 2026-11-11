import * as React from 'react';
import { RichTextEditor } from '@ds/design-system';
import type { MaterialBody } from '@ds/schemas';

const empty = { type: 'doc', content: [{ type: 'paragraph' }] } as unknown as MaterialBody;
const filled = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Что изменилось' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Целевой уровень снижен ' },
        { type: 'text', text: 'для большинства групп', marks: [{ type: 'bold' }] },
        { type: 'text', text: '.' },
      ],
    },
  ],
} as unknown as MaterialBody;

function Sample({ initial, disabled = false, invalid = false }: { initial: MaterialBody; disabled?: boolean; invalid?: boolean }) {
  const [value, setValue] = React.useState(initial);
  return (
    <div style={{ width: 640 }}>
      <RichTextEditor aria-label="Текст материала" value={value} onChange={setValue} disabled={disabled} aria-invalid={invalid} />
    </div>
  );
}

export const Empty = () => <Sample initial={empty} />;
export const Filled = () => <Sample initial={filled} />;
export const Invalid = () => <Sample initial={filled} invalid />;
export const Disabled = () => <Sample initial={filled} disabled />;
