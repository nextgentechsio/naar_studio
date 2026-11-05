import { CatalogueError } from "@/lib/catalogue/library";
import { approve, generateInitial, regenerateShot, selectRun } from "@/lib/catalogue/products";
import { catalogueRoute, jsonBody } from "@/lib/catalogue/http";

export const runtime = "nodejs";
// Approving starts every shot of the template; direct
// (Google / OpenAI) images are made after the response,
// within this time
export const maxDuration = 300;

type Context = { params: Promise<{ id: string; action: string }> };

const ACTIONS = {
  // The initial look (again, with optional feedback)
  generate: generateInitial,
  // Lock the initial look; shoot the rest of the template
  approve,
  // One shot again: { shotId, feedback?, poseId?, backgroundId? }
  regenerate: regenerateShot,
  // Use a version: { shotId, generationId }
  select: selectRun,
};

export async function POST(request: Request, context: Context) {
  const { id, action } = await context.params;
  return catalogueRoute(async (user) => {
    const run = ACTIONS[action as keyof typeof ACTIONS];
    if (!run) throw new CatalogueError(404, "Unknown action");
    return { product: await run(user, id, await jsonBody(request)) };
  });
}
