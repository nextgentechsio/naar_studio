import { MongoClient, type Db } from "mongodb";
import { inject } from "vitest";

// --------------------------------------------------
// Helpers for talking to the app under test
// --------------------------------------------------

export const baseUrl = inject("baseUrl");
export const replicateUrl = inject("replicateUrl");

export type Session = { cookie: string; username: string };

type Options = {
  method?: string;
  session?: Session | null;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
};

export async function api(path: string, options: Options = {}) {
  const headers: Record<string, string> = { ...options.headers };

  if (options.session) headers.cookie = options.session.cookie;

  let body = options.body;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    redirect: "manual",
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data, headers: response.headers };
}

// Polls a run like the Generate page does. A run that
// just succeeded answers "finalizing" while its output is
// saved in the background; keep checking until it's
// settled, as the page does.
export async function pollPrediction(session: Session, id: string) {
  const path = `/api/predictions/${encodeURIComponent(id)}`;

  for (let attempt = 0; ; attempt++) {
    const result = await api(path, { session });
    if (!result.data.finalizing) return result;
    if (attempt >= 100) throw new Error(`${id} still finalizing`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (response.status !== 200) {
    throw new Error(`login ${username} failed: ${response.status} ${await response.text()}`);
  }

  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return { cookie, username };
}

export function loginRoot() {
  const { username, password } = inject("superAdmin");
  return login(username, password);
}

let counter = 0;
const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${++counter}`;

export async function createUser(
  root: Session,
  role: "admin" | "user",
  overrides: Partial<{ username: string; name: string; password: string }> = {}
) {
  const username = overrides.username ?? unique(role);
  const password = overrides.password ?? "Pass-123456789";

  const { status, data } = await api("/api/users", {
    session: root,
    json: { username, name: overrides.name ?? username, password, role },
  });

  if (status !== 201) throw new Error(`create user: ${status} ${JSON.stringify(data)}`);

  const user = data.user as { id: string };
  return { id: user.id, username, password, session: await login(username, password) };
}

export async function createProject(session: Session, name = unique("Project ")) {
  const { status, data } = await api("/api/projects", { session, json: { name } });
  if (status !== 201) throw new Error(`create project: ${status} ${JSON.stringify(data)}`);
  return data.project as { id: string; name: string };
}

// ---------- fake Replicate control ----------

export async function setPrediction(id: string, patch: Record<string, unknown>) {
  await fetch(`${replicateUrl}/__control/predictions/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deletePrediction(id: string) {
  await fetch(`${replicateUrl}/__control/predictions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function replicateRequests(): Promise<
  { method: string; path: string; body: unknown; bytes: number }[]
> {
  return (await fetch(`${replicateUrl}/__control/requests`)).json();
}

export const fakeOutputUrl = () => `${replicateUrl}/__control/output.png`;

// Start a generation through the app; returns its id
export async function startGeneration(
  session: Session,
  project: string,
  model = "google/nano-banana",
  inputs: Record<string, unknown> = { prompt: "a test" }
) {
  const { status, data } = await api("/api/generate", {
    session,
    json: { project, model, inputs },
  });

  if (status !== 200) throw new Error(`generate: ${status} ${JSON.stringify(data)}`);
  return (data.tracking as { predictionId: string }).predictionId;
}

// ---------- direct database access (assertions) ----------

let client: MongoClient | null = null;

export async function db(): Promise<Db> {
  client ??= await MongoClient.connect(inject("mongoUri"));
  return client.db(inject("dbName"));
}

export async function closeDb() {
  await client?.close();
  client = null;
}
