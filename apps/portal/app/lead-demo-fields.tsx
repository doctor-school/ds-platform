"use client";

import { Button } from "@ds/design-system/button";
import { Checkbox } from "@ds/design-system/checkbox";
import { Input } from "@ds/design-system/input";
import { Label } from "@ds/design-system/label";
import { Link } from "@ds/design-system/link";

/**
 * The owned Input tracks its filled state on the client. Keep that boundary local
 * to the visibly disabled fixture fields instead of hydrating the whole demo page.
 */
export function LeadDemoFields() {
  return (
    <fieldset
      disabled
      aria-describedby="academy-lead-demo-note"
      className="text-primary-surface-foreground"
    >
      <legend className="sr-only">Демонстрационные поля</legend>
      <p id="academy-lead-demo-note" className="mb-5 text-sm font-bold">
        Демо: данные не отправляются
      </p>
      <div className="space-y-4.5">
        <div className="space-y-2">
          <Label htmlFor="demo-lead-name" required>
            Имя
          </Label>
          <Input
            id="demo-lead-name"
            placeholder="Как к вам обращаться"
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="demo-lead-company">Компания или клиника</Label>
          <Input
            id="demo-lead-company"
            placeholder="Название организации"
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="demo-lead-contact" required>
            Email или Telegram
          </Label>
          <Input
            id="demo-lead-contact"
            placeholder="name@company.ru или @username"
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="demo-lead-role">Роль</Label>
          <Input id="demo-lead-role" value="Выберите роль" disabled readOnly />
        </div>
        <Checkbox disabled>
          Согласен(а) на обработку персональных данных в соответствии со 152-ФЗ.
        </Checkbox>
        <span className="text-caption">
          <Link
            href="https://doctor.school/index/privacy-pay"
            target="_blank"
            rel="noopener noreferrer"
            variant="inline"
          >
            Политика конфиденциальности
          </Link>
        </span>
        <Button type="button" size="lg" disabled className="w-full">
          Обсудить партнёрство
        </Button>
      </div>
    </fieldset>
  );
}
