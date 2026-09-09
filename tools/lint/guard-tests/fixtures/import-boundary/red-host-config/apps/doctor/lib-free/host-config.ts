// Both host-config bypasses at once: a host-logic import and a callback field.
import { session } from "@/lib/session";

export default {
  title: "Doctor",
  session,
  onSuccess: () => {},
};
