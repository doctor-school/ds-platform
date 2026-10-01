import { LegalDocument } from '@ds/design-system';

const BODY = [
  '## 1. Общие положения',
  '',
  'Настоящая политика обработки персональных данных составлена в соответствии с требованиями Федерального закона № 152-ФЗ «О персональных данных» и определяет порядок обработки персональных данных пользователей образовательной платформы.',
  '',
  '**1.1.** Оператор ставит своей важнейшей целью соблюдение прав и свобод человека и гражданина при обработке его персональных данных.',
  '',
  '## 2. Основные понятия',
  '',
  '**2.1.** Персональные данные — любая информация, относящаяся прямо или косвенно к определённому или определяемому пользователю.',
  '',
  '**2.2.** Пользователь — любой посетитель платформы, в том числе врач, записавшийся на эфир.',
  '',
  '## 3. Какие данные мы обрабатываем',
  '',
  '1. Фамилия, имя, отчество.',
  '2. Электронная почта и номер телефона.',
  '3. Специальность и место работы — для начисления баллов НМО.',
  '',
  '## 4. Сроки хранения',
  '',
  '| Данные | Срок хранения |',
  '| --- | --- |',
  '| Учётная запись | До удаления аккаунта |',
  '| Записи об участии в эфирах | 5 лет |',
  '| Согласия на обработку | 3 года после отзыва |',
  '',
].join('\n');

const document = {
  title: 'Политика персональных данных и согласия',
  edition: '2026-09-07',
  body: BODY,
};

const others = [
  {
    slug: 'consent-photo-video',
    title: 'Согласие на фото- и видеосъёмку',
    href: '#consent-photo-video',
    note: 'Как мы используем записи эфиров',
    editionLabel: 'редакция от 7 сентября 2026',
    updated: true,
  },
  {
    slug: 'consent-congress-submissions',
    title: 'Согласие на обработку заявок на Конгресс',
    href: '#consent-congress-submissions',
    editionLabel: 'редакция от 20 сентября 2026',
  },
];

export const Normal = () => (
  <div className="w-full">
    <LegalDocument document={document} backHref="#" others={others} updated />
  </div>
);

export const Loading = () => (
  <div className="w-full">
    <LegalDocument state="loading" backHref="#" others={others} />
  </div>
);

export const LoadError = () => (
  <div className="w-full">
    <LegalDocument state="error" backHref="#" others={others} onRetry={() => {}} />
  </div>
);

export const NotFound = () => (
  <div className="w-full">
    <LegalDocument state="not-found" backHref="#" others={others} />
  </div>
);
