import { RichTextContent } from '@ds/design-system';
import type { MaterialBody } from '@ds/schemas';

type Mark = { type: string; attrs?: { href: string } };
const text = (value: string, marks?: Mark[]) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const item = (value: string) => ({ type: 'listItem', content: [para(text(value))] });

const body = {
  type: 'doc',
  content: [
    para(
      text('Рекомендации по ведению пациентов с артериальной гипертензией обновляются регулярно, и '),
      text('каждое обновление', [{ type: 'bold' }]),
      text(' меняет повседневную практику. Ниже — '),
      text('главное', [{ type: 'italic' }]),
      text(' из последней редакции.'),
    ),
    { type: 'heading', attrs: { level: 2 }, content: [text('Что изменилось в целевых значениях')] },
    para(
      text('Подробнее — в '),
      text('записи вебинара', [{ type: 'link', attrs: { href: 'https://academy.doctor.school/events' } }]),
      text('.'),
    ),
    { type: 'bulletList', content: [item('Измерение дома — дважды в день.'), item('Контроль через месяц после смены терапии.')] },
    { type: 'blockquote', content: [para(text('Лучшее лечение — то, которое пациент действительно принимает.'))] },
  ],
} as unknown as MaterialBody;

export const EveryNode = () => (
  <div style={{ width: 640 }}>
    <RichTextContent body={body} />
  </div>
);
