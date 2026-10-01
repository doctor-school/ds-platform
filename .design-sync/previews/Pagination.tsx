import { Pagination } from '@ds/design-system';

const copy = {
  onPageChange: () => {},
  navLabel: 'Страницы',
  previousLabel: 'Назад',
  nextLabel: 'Вперёд',
  pageLabel: (n: number) => `Страница ${n}`,
};

export const MiddlePage = () => (
  <Pagination {...copy} page={4} pageCount={12} readout="Показаны 61–80 из 231" />
);

export const FirstPage = () => <Pagination {...copy} page={1} pageCount={12} />;

export const LastPage = () => <Pagination {...copy} page={12} pageCount={12} />;

export const Loading = () => <Pagination {...copy} page={4} pageCount={12} isLoading />;

export const CursorMode = () => <Pagination {...copy} mode="cursor" page={4} hasPrevious hasNext />;
