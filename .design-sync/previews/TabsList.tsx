import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ds/design-system';

export const SignInMethod = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="email">
      <TabsList>
        <TabsTrigger value="email">Почта</TabsTrigger>
        <TabsTrigger value="phone">Телефон</TabsTrigger>
        <TabsTrigger value="sso" disabled>
          Через клинику
        </TabsTrigger>
      </TabsList>
      <TabsContent value="email">
        <p className="text-sm text-muted-foreground">
          Введите почту — пришлём код для входа в личный кабинет врача.
        </p>
      </TabsContent>
      <TabsContent value="phone">
        <p className="text-sm text-muted-foreground">Вход по номеру телефона.</p>
      </TabsContent>
    </Tabs>
  </div>
);

export const SecondTabActive = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="past">
      <TabsList>
        <TabsTrigger value="upcoming">Будущие</TabsTrigger>
        <TabsTrigger value="past">Прошедшие</TabsTrigger>
      </TabsList>
      <TabsContent value="upcoming">
        <p className="text-sm text-muted-foreground">Ближайшие эфиры по вашей специальности.</p>
      </TabsContent>
      <TabsContent value="past">
        <p className="text-sm text-muted-foreground">
          Записи прошедших вебинаров доступны 30 дней после эфира.
        </p>
      </TabsContent>
    </Tabs>
  </div>
);
