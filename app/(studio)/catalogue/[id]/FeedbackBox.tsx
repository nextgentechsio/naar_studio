"use client";

import { FEEDBACK_MAX } from "@/lib/catalogue/shared";
import { Field, textareaClass } from "@/app/components/ui/primitives";

// --------------------------------------------------
// FEEDBACK FOR THE NEXT VERSION, with quick replies
// that add a line to it
// --------------------------------------------------

const QUICK = ["Make the fit looser", "Keep the colour exactly", "Different pose", "Brighter lighting"];

export default function FeedbackBox({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const add = (text: string) => {
    const now = value.trim();
    if (now.toLowerCase().includes(text.toLowerCase())) return;
    onChange(now ? `${now.replace(/[.\s]*$/, "")}. ${text}` : text);
  };

  return (
    <Field label="Feedback" hint="Optional. What to change in the next version.">
      {(props) => (
        <div className="space-y-2">
          <textarea
            {...props}
            rows={3}
            value={value}
            maxLength={FEEDBACK_MAX}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder="e.g. Tuck the shirt in and roll the sleeves once"
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((text) => (
              <button
                key={text}
                type="button"
                disabled={disabled}
                onClick={() => add(text)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-50"
              >
                + {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </Field>
  );
}
