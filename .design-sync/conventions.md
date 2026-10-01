## Doctor.School Design System — how to build with it

**Setup.** No provider, no theme wrapper: every component reads its look from CSS custom properties that `styles.css` defines on `:root`. Dark theme = a `.dark` class on an ancestor (usually `<html>`). Text is Russian product copy; the base font is Inter (loaded from Google Fonts by `styles.css`). Every export — primitives and composed blocks — is on one global: `const { Button, Card, WebinarCard, LoginCard } = window.DsDesignSystem;` (in the product repo the blocks import from `@ds/design-system/blocks`, the rest from `@ds/design-system`).

**Visual language — carried by the components, don't restyle them.** Neo-brutalist: 2px ink borders (`border-2 border-border`), radius 0 everywhere, hard offset shadows with zero blur (`shadow-btn`, `shadow-ghost`, `shadow-lg`), OKLCH neutrals, one brand blue (`bg-primary`, `bg-primary-surface` for the invariant blue band), Inter. Status colours: `success`, `warning`, `destructive`, `live`. Interactive states (hover lift, pressed collapse, focus ring) live inside the primitives — use `Button` / `Link` / `FilterChip` / `Checkbox` instead of styling a raw element.

**Styling idiom for your own layout.** The stylesheet is a precompiled Tailwind 4 build: only utilities the design system itself uses exist (e.g. `flex`, `grid`, `gap-4`, `p-6`, `bg-background`, `bg-card`, `bg-section`, `text-foreground`, `text-muted-foreground`, `border-2`, `border-border`, `border-hairline`, `shadow-btn`). An arbitrary or unused class silently does nothing. For anything else use inline styles with the token variables — never hex values:

- colour: `var(--color-background)`, `--color-foreground`, `--color-card`, `--color-section`, `--color-muted-foreground`, `--color-primary`, `--color-primary-surface`, `--color-border`, `--color-hairline`
- spacing: `var(--space-2|3|4|6|8|10|12|16)`, semantic `--space-gutter`, `--space-stack`, `--space-section`, `--space-panel`
- type: `var(--font-size-sm|base|lg|xl|2xl|3xl|4xl)`, `--font-weight-semibold|bold|extrabold`
- width: `var(--container-content)` (page column), `--container-auth` (auth card)
- elevation: `var(--shadow-btn)`, `--shadow-lg`; borders `var(--border-width-2) solid var(--color-border)`

**Where the truth lives.** Each component's `<Name>.d.ts` is its API; its preview card shows the sanctioned compositions. Compound parts are separate exports used together exactly like shadcn/ui: `Card` + `CardHeader/CardTitle/CardDescription/CardContent/CardFooter`; `Dialog` / `AlertDialog` / `Sheet` + their `*Content/*Header/*Title/*Description/*Footer`; `Tabs` + `TabsList/TabsTrigger/TabsContent`; `Table` + `TableHeader/TableBody/TableRow/TableHead/TableCell`; `InputOTP` + `InputOTPGroup/InputOTPSlot`. Blocks (`WebinarCard`, `EventPageShell`, `EventSignupCard`, `LoginCard`, `RegisterCard`, `DataTable`, `EventsFilter`, `MonthCalendarGrid`, …) are whole product units: pass data and copy as props, never rebuild them from primitives. All user-facing copy is a prop — the components ship no strings of their own.

**Product rules.** Event cost is shown only as «N Pul» — Pul is not money: never «бесплатно», never roubles. Times are Moscow time with an explicit «МСК» label.

```jsx
const {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge,
} = window.DsDesignSystem;

<section
  style={{
    maxWidth: "var(--container-content)",
    margin: "0 auto",
    padding: "var(--space-8) var(--space-gutter)",
  }}
>
  <Card>
    <CardHeader>
      <CardTitle>Школа кардиологии</CardTitle>
      <CardDescription>
        Цикл вебинаров для терапевтов и кардиологов · НМО · 2 ЗЕТ
      </CardDescription>
    </CardHeader>
    <CardContent className="flex gap-4">
      <Badge>НМО · 2 ЗЕТ</Badge>
      <Badge variant="success">Вы записаны</Badge>
    </CardContent>
    <CardFooter>
      <Button>Записаться</Button>
    </CardFooter>
  </Card>
</section>;
```
