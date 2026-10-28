"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { fetchActiveProjects } from "@/lib/client/data";
import { errorMessage } from "@/lib/client/http";
import { goToSignIn } from "@/lib/client/session-ended";
import { HEARTBEAT_MS } from "@/lib/auth/presence";
import type { PublicProject, PublicUser } from "@/lib/auth/roles";

// --------------------------------------------------
// STUDIO CONTEXT
//
// The signed-in user (resolved on the server by the
// layout) and the active project list, shared by every
// page. Lives in the layout, so it survives navigation.
// --------------------------------------------------

type StudioContextValue = {
  currentUser: PublicUser;
  // When this session signed in (ms since epoch)
  sessionStartedAt: number;
  projects: PublicProject[];
  projectsError: string;
  refreshProjects: () => void;
};

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({
  currentUser,
  sessionStartedAt,
  children,
}: {
  currentUser: PublicUser;
  sessionStartedAt: number;
  children: React.ReactNode;
}) {
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [projectsError, setProjectsError] = useState("");

  const refreshProjects = useCallback(() => {
    fetchActiveProjects()
      .then((list) => {
        setProjects(list);
        setProjectsError("");
      })
      .catch((err) =>
        setProjectsError(errorMessage(err, "Unable to load projects."))
      );
  }, []);

  // State is only set in the promise callbacks
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Presence heartbeat while this tab is visible, so the
  // super admin can see who's online (lib/auth/presence.ts)
  useEffect(() => {
    // Also notices, within a minute, that this session
    // ended (signed in elsewhere, disabled, password reset)
    const beat = () => {
      if (document.visibilityState !== "visible") return;

      fetch("/api/presence", { method: "POST", keepalive: true })
        .then(async (response) => {
          if (response.status !== 401) return;

          const data = await response.json().catch(() => ({}));
          goToSignIn((data as { code?: unknown }).code);
        })
        .catch(() => {
          // Offline for a moment: the next beat will do
        });
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return (
    <StudioContext.Provider
      value={{
        currentUser,
        sessionStartedAt,
        projects,
        projectsError,
        refreshProjects,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);

  if (!value) {
    throw new Error("useStudio must be used inside <StudioProvider>");
  }

  return value;
}

export async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    // Full reload on purpose: drop every bit of client
    // state (Generate draft, cached data) on sign-out
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}
