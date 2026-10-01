import { AccountProfileCard } from '@ds/design-system';

const copy = {
  title: 'Личный кабинет',
  subtitle: 'Ваши данные и настройки входа',
  sections: { profile: 'Профиль', security: 'Безопасность', session: 'Сессия' },
  nameLabel: 'Имя',
  nameEmpty: 'Не указано',
  nameEdit: 'Изменить',
  nameAdd: 'Добавить',
  nameSave: 'Сохранить',
  nameCancel: 'Отмена',
  nameInputLabel: 'Отображаемое имя',
  emailLabel: 'Электронная почта',
  emailVerified: 'Подтверждена',
  phoneLabel: 'Телефон',
  phoneEmpty: 'Не указан',
  passwordLabel: 'Пароль',
  passwordChange: 'Изменить пароль',
  passwordHelper: 'Мы отправим ссылку для смены пароля',
  eventsLabel: 'События',
  eventsTitle: 'Мои события',
  eventsHelper: 'Регистрации и записи прошедших эфиров',
  congressTitle: 'Мои заявки на Конгресс',
  signOut: 'Выйти',
};

const handlers = {
  onSaveDisplayName: async () => {},
  resolveSaveError: () => 'Не удалось сохранить имя. Попробуйте ещё раз.',
  onSignOut: () => {},
};

export const Filled = () => (
  <div style={{ width: 640 }}>
    <AccountProfileCard
      profile={{
        email: 'doctor@example.ru',
        emailVerified: true,
        phone: '+7 900 000-00-00',
        phoneVerified: true,
        displayName: 'Анна Петрова',
      }}
      copy={copy}
      initials="АП"
      passwordHref="#reset"
      eventsHref="#events"
      congressHref="#congress"
      {...handlers}
    />
  </div>
);

export const EmptyIdentity = () => (
  <div style={{ width: 640 }}>
    <AccountProfileCard
      profile={{
        email: 'doctor@example.ru',
        emailVerified: false,
        phone: null,
        phoneVerified: null,
        displayName: null,
      }}
      copy={copy}
      initials={null}
      passwordHref="#reset"
      eventsHref="#events"
      {...handlers}
    />
  </div>
);

export const RowsHidden = () => (
  <div style={{ width: 640 }}>
    <AccountProfileCard
      profile={{
        email: 'doctor@example.ru',
        emailVerified: true,
        phone: '+7 900 000-00-00',
        phoneVerified: true,
        displayName: 'Анна Петрова',
      }}
      copy={copy}
      initials="АП"
      passwordHref={null}
      eventsHref={null}
      {...handlers}
    />
  </div>
);
