import { AccountProfileCard, type AccountPhoneActions } from '@ds/design-system';

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
  phone: {
    add: 'Добавить',
    confirm: 'Подтвердить',
    change: 'Изменить',
    verified: 'подтверждён',
    unconfirmedHelper: 'Не подтверждён — подтвердите, чтобы входить по SMS',
    suggestedHelper: 'Из заявки на конгресс — подтвердите, чтобы входить по SMS',
    confirmedNote: 'Телефон подтверждён. Теперь можно входить по коду из SMS',
    inputLabel: 'Номер телефона',
    placeholder: '+7…',
    send: 'Получить код',
    cancel: 'Отмена',
    codeSentTo: 'Код отправлен по SMS на',
    codeLabel: 'Код из SMS',
    back: '← Изменить номер',
    resend: 'Отправить снова',
    resendCountdown: (seconds: number) => `Отправить снова · ${seconds} с`,
    wrongCode: 'Неверный код',
    throttled: 'Слишком много попыток. Попробуйте позже',
    unavailable: 'Сервис временно недоступен — попробуйте ещё раз.',
  },
  passwordLabel: 'Пароль',
  passwordChange: 'Изменить пароль',
  passwordHelper: 'Мы отправим ссылку для смены пароля',
  eventsLabel: 'События',
  eventsTitle: 'Мои события',
  eventsHelper: 'Регистрации и записи прошедших эфиров',
  congressTitle: 'Мои заявки на Конгресс',
  signOut: 'Выйти',
};

/* Preview transport: any number gets a code; 123456 confirms it. */
let previewPhone = '';
const phoneActions: AccountPhoneActions = {
  requestCode: async (phone) => {
    previewPhone = phone;
    return 'code_sent';
  },
  confirm: async (code) => {
    if (code !== '123456') throw new Error('invalid');
    return previewPhone;
  },
  classifyError: () => 'invalid',
};

const handlers = {
  phoneActions,
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
        suggestedPhone: null,
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
        suggestedPhone: null,
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
        suggestedPhone: null,
      }}
      copy={copy}
      initials="АП"
      passwordHref={null}
      eventsHref={null}
      {...handlers}
    />
  </div>
);
