import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/auth";
import { homeFor } from "@/lib/auth/platforms";

// The studio starts on the first platform the account may
// use (Replicate for most), or History when it has none
export default async function StudioHome() {
  const { user } = await getSession();
  redirect(user ? homeFor(user.platforms) : "/login");
}
