import { APP_COMMIT, APP_NAME, copyrightLine, versionLabel } from "@/lib/app-info";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// PAGE FOOTER
//
// The same line at the bottom of every page: copyright
// on the left, app and version on the right (the build
// in its tooltip). A fixed 40px tall (FOOTER_HEIGHT), so
// layouts that size to the viewport can allow for it.
// --------------------------------------------------

export const FOOTER_HEIGHT = "2.5rem";

export default function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cx(
        "flex h-10 shrink-0 items-center justify-between gap-3 border-t border-line px-4 text-[11px] text-fg-subtle lg:px-6",
        className,
      )}
    >
      <span className="truncate">{copyrightLine()}</span>
      <span className="shrink-0 tabular-nums" title={APP_COMMIT ? `Build ${APP_COMMIT}` : undefined}>
        {APP_NAME} {versionLabel()}
      </span>
    </footer>
  );
}
