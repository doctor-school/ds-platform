import { MaterialArticle } from '@ds/design-system';
import type { MaterialBody } from '@ds/schemas';

const body = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Методология — в обзоре на ' },
        { type: 'text', text: 'PubMed', marks: [{ type: 'link', attrs: { href: 'https://pubmed.ncbi.nlm.nih.gov/' } }] },
        { type: 'text', text: '.' },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Нет общего языка' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Клиники и лаборатории описывают одни и те же препараты по-разному.' }],
    },
  ],
} as unknown as MaterialBody;

export const Column = () => (
  <MaterialArticle
    backHref="#news"
    material={{
      kind: 'column',
      title: 'Ортобиология в России: чего не хватает практике',
      publishedAt: '2026-08-18T21:30:00.000Z',
      author: { name: 'Страхов Михаил Андреевич' },
      partner: null,
      cover: null,
      body,
    }}
  />
);

export const Loading = () => <MaterialArticle state="loading" />;

export const ReadError = () => <MaterialArticle state="error" onRetry={() => {}} />;
