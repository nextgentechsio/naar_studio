// --------------------------------------------------
// CATALOGUE: a run that couldn't start, with the HTTP
// status to answer with. Images are made only by the
// direct Google / OpenAI calls (lib/catalogue/direct.ts,
// queued by lib/catalogue/queue.ts), as in the original.
// --------------------------------------------------

export class RunError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
