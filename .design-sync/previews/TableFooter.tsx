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

