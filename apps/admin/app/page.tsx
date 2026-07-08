import { redirect } from "next/navigation";

/** Root → the events resource (the only wave-1 admin surface, design §8). */
export default function AdminHome() {
  redirect("/events");
}
