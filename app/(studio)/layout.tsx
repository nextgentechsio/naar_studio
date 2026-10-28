import { redirect } from "next/navigation";
import { getSession, getSessionStartedAt } from "@/lib/auth/auth";
import { toPublicUser } from "@/lib/auth/users";
import { GenerateProvider } from "./_generate/GenerateProvider";
import StudioShell from "./_components/StudioShell";
import { StudioProvider } from "./_components/StudioProvider";

// --------------------------------------------------
// STUDIO LAYOUT (every signed-in page)
//
// proxy.ts already turns away requests without a valid
// cookie; this also catches disabled accounts and
// revoked sessions, and hands the user to the client
// without an extra /api/auth/me round trip. The layout
// persists across navigation, so the shell and the
// Generate state survive moving between pages.
// --------------------------------------------------

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, replaced } = await getSession();
  const sessionStartedAt = await getSessionStartedAt();

  // The cookie is genuine but the session is over: say
  // why (the login page clears the dead cookie)
  if (replaced) redirect("/login?reason=replaced");
  if (!user || sessionStartedAt === null) redirect("/login?reason=ended");

  return (
    <StudioProvider
      currentUser={toPublicUser(user)}
      sessionStartedAt={sessionStartedAt}
    >
      {/* One per provider, each keeping its own form and run */}
      <GenerateProvider>
        <GenerateProvider provider="higgsfield">
          <StudioShell>{children}</StudioShell>
        </GenerateProvider>
      </GenerateProvider>
    </StudioProvider>
  );
}
