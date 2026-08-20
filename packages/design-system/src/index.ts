export { cn } from "./lib/utils";

// ── Interaction-state contract (ADR-0013 §7 layer 2, #273) ────────────────────
export { interactiveBase } from "./primitives/interactive-base";

// ── Primitives (owned shadcn components) ──────────────────────────────────────
export { Button, buttonVariants, type ButtonProps } from "./primitives/button";
export { Link, linkVariants, type LinkProps } from "./primitives/link";
export { Input } from "./primitives/input";
export {
  NativeSelect,
  type NativeSelectProps,
} from "./primitives/native-select";
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
  FormErrorSummary,
  FormField,
  type FormErrorSummaryItem,
  type FormErrorSummaryProps,
} from "./primitives/form";
export {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "./primitives/input-otp";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./primitives/tabs";
// ── 014 modal element class (#1339, Stage A #1337) — adopted from official
//    shadcn/ui `dialog` + `alert-dialog` (MIT) on their Radix substrate. Built
//    once here because 014's recordings panel and 007's mark-ended command
//    (#1338) both confirm in a modal (#1280/#1336 shared-class rule).
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./primitives/dialog";
export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./primitives/alert-dialog";
// ── 012 authoring controls (#1283, Stage A #1282) ─────────────────────────────
export { Textarea, type TextareaProps } from "./primitives/textarea";
export {
  MediaDropzone,
  type MediaDropzoneProps,
} from "./primitives/media-dropzone";

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
export {
  AuthLayout,
  AuthCard,
  OtpFocusScreen,
  maskDestination,
} from "./blocks";
