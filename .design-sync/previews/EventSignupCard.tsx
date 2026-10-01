import { Badge, EventSignupCard } from '@ds/design-system';

const conditions = [
  { label: 'Участие', value: '120 Pul' },
  { label: 'Формат', value: 'Онлайн · комната эфира' },
  { label: 'Длительность', value: <span className="tabular-nums">90 минут</span> },
  { label: 'НМО', value: <Badge variant="label">2 балла</Badge> },
];

const base = {
  timeLabel: '19:00',
  dateLabel: '28 августа',
  weekdayLabel: 'пятница · МСК',
  conditions,
  pinned: false,
};

export const Register = () => (
  <div style={{ width: 360 }}>
    <EventSignupCard
      {...base}
      cta={{ action: 'register', label: 'Участвовать', href: '#register', reason: null, presenceCount: null }}
      note="Нужна регистрация — вернём вас на эту страницу."
      proof={<span>Уже записались 37 ортопедов</span>}
    />
  </div>
);

export const Registered = () => (
  <div style={{ width: 360 }}>
    <EventSignupCard {...base} cta={{ action: 'registered', label: 'Вы записаны — напомним за час', href: null, reason: null, presenceCount: null }} />
  </div>
);

export const EnterRoom = () => (
  <div style={{ width: 360 }}>
    <EventSignupCard
      {...base}
      cta={{ action: 'enter-room', label: 'Войти в эфир', href: '#room', reason: null, presenceCount: 3 }}
    />
  </div>
);

export const SwitchToOnline = () => (
  <div style={{ width: 360 }}>
    <EventSignupCard
      {...base}
      cta={{
        action: 'switch-to-online',
        label: 'Смотреть онлайн',
        href: '#online',
        reason: 'Очные места закончились — эфир открыт для всех.',
        presenceCount: null,
      }}
    />
  </div>
);

export const SoldOut = () => (
  <div style={{ width: 360 }}>
    <EventSignupCard
      {...base}
      cta={{ action: 'sold-out', label: 'Мест не осталось', href: null, reason: 'Все 40 очных мест заняты.', presenceCount: null }}
    />
  </div>
);

export const Unavailable = () => (
  <div style={{ width: 360 }}>
    <EventSignupCard
      {...base}
      cta={{
        action: 'unavailable',
        label: 'Участие закрыто',
        href: null,
        reason: 'Событие завершилось — запись появится в архиве.',
        presenceCount: null,
      }}
    />
  </div>
);
