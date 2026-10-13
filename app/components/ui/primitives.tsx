"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/app/components/ui/Icon";

// --------------------------------------------------
// UI PRIMITIVES
//
// The only place spacing, radius and color decisions
// for common controls live. Built on the semantic
// tokens in globals.css, so they work in both themes.
// --------------------------------------------------

export function cx(
  ...classes: (string | false | null | undefined)[]
) {
  return classes.filter(Boolean).join(" ");
}

// ---------- Buttons ----------

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover",
  secondary:
    "border border-line-strong bg-surface text-fg hover:bg-raised",
  ghost: "text-fg-muted hover:bg-raised hover:text-fg",
  danger:
    "border border-danger/40 text-danger hover:bg-danger/10",
};

const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-sm",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: keyof typeof BUTTON_SIZES = "md"
) {
  return cx(
    "inline-flex items-center justify-center font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size]
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: React.ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      className={cx(buttonClass(variant, size), className)}
      {...props}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

// ---------- Form controls ----------

export const inputClass =
  "h-10 w-full rounded-lg border border-line bg-sunken px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent disabled:opacity-60";

// Password field with a show/hide (eye) button. Starts
// hidden, and hides again after the form is submitted
// or the page changes (state is per mount).
export function PasswordInput({
  className = "",
  baseClassName = inputClass,
  ...props
}: Omit<React.ComponentPropsWithRef<"input">, "type"> & {
  // Swap the field style to match a form that uses its own
  baseClassName?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={cx(baseClassName, "pr-10", className)}
      />

      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-fg-subtle transition-colors hover:text-fg focus-visible:text-fg"
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={16} />
      </button>
    </div>
  );
}

export const textareaClass =
  "w-full rounded-lg border border-line bg-sunken px-3 py-2.5 text-sm leading-6 text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent";

// Label + control + hint/error, wired with ids so screen
// readers announce the label and help text.
export function Field({
  label,
  hint,
  error,
  required,
  hideLabel,
  info,
  className,
  children,
}: {
  label: string;
  // Help shown as an ⓘ tooltip instead of a line of text
  // (compact forms); still read out by screen readers
  info?: string;
  // Extra classes for the wrapper (e.g. to let it grow)
  className?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  // Still announced to screen readers; use when a
  // heading right above already names the control
  hideLabel?: boolean;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const described = hint || error || info;

  return (
    <div className={cx("space-y-1.5", className)}>
      <label
        htmlFor={id}
        className={cx(
          "block text-sm font-medium text-fg",
          hideLabel && "sr-only"
        )}
      >
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
        {info && (
          <span
            title={info}
            aria-hidden
            className="ml-1 inline-flex translate-y-0.5 cursor-help text-fg-subtle"
          >
            <Icon name="info" size={13} />
          </span>
        )}
      </label>

      {children({
        id,
        "aria-describedby": described ? hintId : undefined,
        "aria-invalid": error ? true : undefined,
      })}

      {info && !error && !hint && (
        <p id={hintId} className="sr-only">
          {info}
        </p>
      )}

      {(error || hint) && (
        <p
          id={hintId}
          className={cx(
            "text-xs leading-5",
            error ? "text-danger" : "text-fg-subtle"
          )}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

// ---------- Layout ----------

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        "rounded-xl border border-line bg-surface shadow-card",
        className
      )}
    >
      {children}
    </section>
  );
}

// Numbered step header used by the Generate flow
export function StepHeader({
  step,
  title,
  description,
  done,
  aside,
}: {
  step: number;
  title: string;
  description?: string;
  done?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span
          className={cx(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done
              ? "bg-accent text-on-accent"
              : "border border-line-strong text-fg-muted"
          )}
          aria-hidden
        >
          {done ? <Icon name="check" size={14} /> : step}
        </span>

        <div>
          <h2 className="text-sm font-semibold text-fg">
            {title}
          </h2>

          {description && (
            <p className="mt-0.5 text-xs leading-5 text-fg-subtle">
              {description}
            </p>
          )}
        </div>
      </div>

      {aside}
    </div>
  );
}

// Step content, indented to line up with the step title
// (badge 24px + gap 12px) so each card has one left edge
export function StepBody({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("mt-4 sm:pl-9", className)}>{children}</div>
  );
}

// NAAR-style small caps label ("MAKE COMMERCE HUMAN")
export const eyebrowClass =
  "text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className={cx(eyebrowClass, "mb-2")}>{eyebrow}</p>
        )}

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          {title}
        </h1>

        {description && (
          <p className="mt-1 text-sm text-fg-muted">
            {description}
          </p>
        )}
      </div>

      {actions}
    </div>
  );
}

// ---------- Feedback ----------

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-line bg-sunken text-fg-muted",
  accent: "border-accent/30 bg-accent-soft text-accent",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const ALERT_TONES: Record<
  Exclude<Tone, "neutral" | "accent">,
  { classes: string; icon: IconName }
> = {
  success: {
    classes: "border-success/40 bg-success/10 text-success",
    icon: "check",
  },
  warning: {
    classes: "border-warning/40 bg-warning/10 text-warning",
    icon: "alert",
  },
  danger: {
    classes: "border-danger/40 bg-danger/10 text-danger",
    icon: "alert",
  },
};

export function Alert({
  tone = "danger",
  children,
}: {
  tone?: "success" | "warning" | "danger";
  children: ReactNode;
}) {
  const style = ALERT_TONES[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        style.classes
      )}
    >
      <Icon name={style.icon} size={16} className="mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
      aria-hidden
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-8" : "py-14"
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-sunken text-fg-muted">
        <Icon name={icon} size={20} />
      </span>

      <p className="mt-4 text-sm font-medium text-fg">
        {title}
      </p>

      {description && (
        <p className="mt-1 max-w-sm text-sm text-fg-subtle">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------- Formatting ----------

// Costs: 2 decimals from $1, 3 below that (Replicate
// image prices are fractions of a cent apart).
export function formatCost(
  amount: number | null | undefined
): string {
  if (
    amount === null ||
    amount === undefined ||
    !Number.isFinite(amount)
  ) {
    return "—";
  }

  if (amount === 0) return "$0.00";

  const sign = amount < 0 ? "-" : "";
  const value = Math.abs(amount);

  // Never show a real charge as "$0.000"
  if (value < 0.001) return `${sign}<$0.001`;

  return value >= 1
    ? `${sign}$${value.toFixed(2)}`
    : `${sign}$${value.toFixed(3)}`;
}
