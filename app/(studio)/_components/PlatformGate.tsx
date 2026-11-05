import Link from "next/link";
import { getSession } from "@/lib/auth/auth";
import { canUsePlatform, homeFor, platformLabel, type PlatformKey } from "@/lib/auth/platforms";
import { EmptyState } from "@/app/components/ui/primitives";

// A Create page, only for accounts allowed on its platform
// (the API refuses their runs anyway; this explains why)
export default async function PlatformGate({
  platform,
  children,
}: {
  platform: PlatformKey;
  children: React.ReactNode;
}) {
  const { user } = await getSession();
  if (!user || canUsePlatform(user, platform)) return <>{children}</>;

  const home = homeFor(user.platforms);

  return (
    <EmptyState
      icon="alert"
      title={`${platformLabel(platform)} isn't turned on for your account`}
      description="Ask an admin to give you access. You can still see your History, Elements and spend."
      action={
        <Link
          href={home}
          className="inline-flex items-center justify-center rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-fg hover:bg-raised"
        >
          Go to {home === "/history" ? "History" : platformLabel(user.platforms[0])}
        </Link>
      }
    />
  );
}
