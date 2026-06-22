export { cn } from "./lib/utils";

// ── Interaction-state contract (ADR-0013 §7 layer 2, #273) ────────────────────
export { interactiveBase } from "./primitives/interactive-base";

// ── Primitives (owned shadcn components) ──────────────────────────────────────
export { Button, buttonVariants, type ButtonProps } from "./primitives/button";
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
export { AuthCard, OtpFocusScreen, maskDestination } from "./blocks";
