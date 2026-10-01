import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@ds/design-system';

export const Composed = () => (
  <div style={{ width: 380 }}>
    <Card>
      <CardHeader>
        <CardTitle>Подтвердите участие</CardTitle>
        <CardDescription>
          Вебинар «Артериальная гипертензия: новые клинические рекомендации» — 16 июля, 19:00 МСК.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">
          За просмотр трансляции целиком начисляются баллы НМО. Ссылку на эфир пришлём на почту за час до начала.
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">Записаться</Button>
        <Button size="sm" variant="outline">
          Позже
        </Button>
      </CardFooter>
    </Card>
  </div>
);

export const HeaderAndContent = () => (
  <div style={{ width: 380 }}>
    <Card>
      <CardHeader>
        <CardTitle>Профиль врача</CardTitle>
        <CardDescription>Специальность и место работы видны организаторам эфиров.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">Кардиолог · Городская клиническая больница № 1</p>
      </CardContent>
    </Card>
  </div>
);
