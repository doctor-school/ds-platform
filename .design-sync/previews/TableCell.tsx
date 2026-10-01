import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@ds/design-system';

const ROWS = [
  { title: 'Клиническая лабораторная диагностика', code: '31.08.05', specialties: 14, published: true },
  { title: 'Сердечно-сосудистая хирургия', code: '31.08.63', specialties: 9, published: true },
  { title: 'Функциональная диагностика', code: '31.08.12', specialties: 6, published: false },
  { title: 'Акушерство и гинекология', code: '31.08.01', specialties: 21, published: true },
];

export const Directions = () => (
  <Table regionLabel="Направления">
    <TableCaption>Направления каталога · обновлено 1 октября 2026</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Направление</TableHead>
        <TableHead>Код номенклатуры</TableHead>
        <TableHead className="text-right">Специальностей</TableHead>
        <TableHead>Статус</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {ROWS.map((row) => (
        <TableRow key={row.code}>
          <TableCell>{row.title}</TableCell>
          <TableCell>{row.code}</TableCell>
          <TableCell className="text-right">{row.specialties}</TableCell>
          <TableCell>
            <Badge className={row.published ? 'bg-success-tint text-success-text' : 'bg-warning-tint text-foreground'}>
              {row.published ? 'Опубликовано' : 'Черновик'}
            </Badge>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableCell colSpan={2}>Итого</TableCell>
        <TableCell className="text-right">50</TableCell>
        <TableCell />
      </TableRow>
    </TableFooter>
  </Table>
);

export const WithoutFooter = () => (
  <Table regionLabel="Ближайшие эфиры">
    <TableHeader>
      <TableRow>
        <TableHead>Дата</TableHead>
        <TableHead>Эфир</TableHead>
        <TableHead>Спикер</TableHead>
        <TableHead className="text-right">Баллы НМО</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>7 октября, 19:00</TableCell>
        <TableCell>Разбор клинических случаев в кардиологии</TableCell>
        <TableCell>Д-р Мария Соколова</TableCell>
        <TableCell className="text-right">2</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>9 октября, 18:30</TableCell>
        <TableCell>Новое в терапии сахарного диабета 2 типа</TableCell>
        <TableCell>Д-р Игорь Лебедев</TableCell>
        <TableCell className="text-right">1</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
