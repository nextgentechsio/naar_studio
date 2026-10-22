import { redirect } from "next/navigation";

// The studio starts on Replicate
export default function StudioHome() {
  redirect("/replicate");
}
