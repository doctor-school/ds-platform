import { RegistrationSuccessCard } from '@ds/design-system';

const base = {
  title: 'Почта подтверждена',
  primary: { href: '#', label: 'Вернуться к эфиру →' },
  secondary: { href: '#', label: 'В личный кабинет' },
};

export const PendingAccrual = () => (
  <div style={{ width: 440 }}>
    <RegistrationSuccessCard
      {...base}
      accrual="Стартовые очки за регистрацию начислим на ваш счёт."
    />
  </div>
);

export const CreditedWithProfileNudge = () => (
  <div style={{ width: 440 }}>
    <RegistrationSuccessCard
      {...base}
      accrual="Начислено 20 Pul — стартовые очки за регистрацию."
      profileCompletion="Заполните профиль — ещё 30 Pul и доступ к сертификатам НМО."
    />
  </div>
);

export const DegradedLanding = () => (
  <div style={{ width: 440 }}>
    <RegistrationSuccessCard
      {...base}
      accrual="Стартовые очки за регистрацию начислим на ваш счёт."
      reason="Эфир «Пластика ахиллова сухожилия», на который вы записывались, уже завершился — откроем его страницу."
      primary={{ href: '#', label: 'Открыть страницу эфира →' }}
    />
  </div>
);
