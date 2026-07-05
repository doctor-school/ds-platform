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

// ── Language primitives (#513) — the classes the neo-brutalist language (#511)
//    introduces: filter-chip / badge / avatar / checkbox / radio / switch /
//    alert / skeleton / day-band. ────────────────────────────────────────────
export { FilterChip } from "./primitives/filter-chip";
export { Badge, badgeVariants, type BadgeProps } from "./primitives/badge";
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  avatarVariants,
} from "./primitives/avatar";
export { Checkbox } from "./primitives/checkbox";
export { RadioGroup, RadioGroupItem } from "./primitives/radio";
export { Switch } from "./primitives/switch";
export {
  Alert,
  AlertTitle,
  AlertDescription,
  alertVariants,
  type AlertProps,
} from "./primitives/alert";
export { Skeleton } from "./primitives/skeleton";
export { DayBand, type DayBandProps } from "./primitives/day-band";

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
