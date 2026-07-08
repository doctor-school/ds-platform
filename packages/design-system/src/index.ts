export { cn } from "./lib/utils";

// ── Interaction-state contract (ADR-0013 §7 layer 2, #273) ────────────────────
export { interactiveBase } from "./primitives/interactive-base";

// ── Primitives (owned shadcn components) ──────────────────────────────────────
export { Button, buttonVariants, type ButtonProps } from "./primitives/button";
export { Link, linkVariants, type LinkProps } from "./primitives/link";
export { Input } from "./primitives/input";
export { Label } from "./primitives/label";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "./primitives/card";
export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
} from "./primitives/form";
export {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "./primitives/input-otp";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./primitives/tabs";

// ── New-language primitives (#513, source §05–§08) ────────────────────────────
export {
  FilterChip,
  filterChipVariants,
  type FilterChipProps,
} from "./primitives/filter-chip";
export { Badge, badgeVariants, type BadgeProps } from "./primitives/badge";
export { Avatar, avatarVariants, type AvatarProps } from "./primitives/avatar";
export { Checkbox, type CheckboxProps } from "./primitives/checkbox";
export { Radio, type RadioProps } from "./primitives/radio";
export { Switch, type SwitchProps } from "./primitives/switch";
export { Alert, alertVariants, type AlertProps } from "./primitives/alert";
export { Skeleton } from "./primitives/skeleton";
export { DayBand } from "./primitives/day-band";
export {
  WebinarCard,
  type WebinarCardProps,
  type WebinarCardSpeaker,
} from "./primitives/webinar-card";
export {
  WebinarPageContent,
  type WebinarPageContentProps,
  type WebinarPageSpeaker,
  type WebinarPagePartner,
} from "./primitives/webinar-page-content";
export {
  WebinarStatusCard,
  type WebinarStatusCardProps,
} from "./primitives/webinar-status-card";
export {
  WebinarRoomLayout,
  type WebinarRoomLayoutProps,
} from "./primitives/webinar-room";

// ── Layout primitive (#514, source §09 «Раскладка и ритм») ─────────────────────
export {
  Container,
  containerVariants,
  type ContainerProps,
} from "./primitives/container";

// ── Field primitives (#197) ───────────────────────────────────────────────────
export {
  EmailField,
  PhoneField,
  OtpField,
  PasswordField,
  IdentifierField,
  EmailFieldSchema,
  PhoneFieldSchema,
  IdentifierFieldSchema,
  OtpCodeFieldSchema,
  NewPasswordFieldSchema,
  CurrentPasswordFieldSchema,
  maskPhoneInput,
} from "./primitives/fields";

// ── Blocks (#235 / #227) ──────────────────────────────────────────────────────
export { AuthLayout, AuthCard, OtpFocusScreen, maskDestination } from "./blocks";
