import type { PublicProduct } from "@/lib/catalogue/shared";
import type { Library } from "@/lib/client/catalogue";
import type { Step } from "./Stepper";

// What every step of the product workspace gets
export type StepProps = {
  product: PublicProduct;
  // null while it loads
  library: Library | null;
  // Saves fields (PATCH); false when it failed (the
  // workspace shows the server's message)
  update: (body: Record<string, unknown>) => Promise<boolean>;
  // Runs an action that returns the product (generate,
  // approve, regenerate, select); resolves to the error
  // message when it failed (also shown by the workspace),
  // or null
  act: (run: () => Promise<{ product: PublicProduct }>, fallback: string) => Promise<string | null>;
  goTo: (step: Step) => void;
};
