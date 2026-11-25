import type { ReactNode } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";
import { NaarLogo } from "@/app/components/ui/NaarLogo";
import AppFooter from "@/app/components/AppFooter";
import { eyebrowClass } from "@/app/components/ui/primitives";

// A centred card for the signed-out pages beside sign-in
// (forgot password, set a new password)
export default function AuthCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col text-fg">
      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2">
            <NaarLogo height={26} />
            <span className="pt-0.5 text-[15px] font-medium text-fg-muted">Studio</span>
          </div>
          <p className={eyebrowClass}>{eyebrow}</p>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
          {children}
          <div className="mt-8 flex justify-center">
            <ThemeToggle />
          </div>
        </div>
      </div>
      <AppFooter />
    </main>
  );
}
