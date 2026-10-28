import { spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";
import { FAKE_BLOB_TOKEN, FAKE_ELEVENLABS_KEY, FAKE_HF_CREDENTIALS, startFakeReplicate } from "./fake-replicate";

// --------------------------------------------------
// INTEGRATION SETUP
//
// 1. In-memory MongoDB (nothing touches the real one)
// 2. Fake Replicate API (no real runs, no cost)
// 3. `next build` + `next start` with env pointing at both
//    (process env wins over .env.local, so the real
//    database URI and token are never used)
//
// Set SKIP_BUILD=1 to reuse an existing build.
// --------------------------------------------------

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    replicateUrl: string;
    mongoUri: string;
    dbName: string;
    superAdmin: { username: string; password: string };
  }
}

const ROOT = path.resolve(__dirname, "../..");
const DB_NAME = "naar_integration";
const SUPER_ADMIN = { username: "root", password: "Root-pass-123456" };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitFor(url: string, child: ChildProcess, log: () => string) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early:\n${log()}`);
    }

    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Server did not start:\n${log()}`);
}

export default async function setup(project: TestProject) {
  const mongo = await MongoMemoryServer.create();
  const replicate = await startFakeReplicate();
  let server: ChildProcess | null = null;

  // A failed setup must not leave anything running
  const stopAll = async () => {
    server?.kill();
    await replicate.close();
    await mongo.stop();
  };

  try {
    return await start(project, mongo, replicate, (child) => (server = child), stopAll);
  } catch (error) {
    await stopAll();
    throw error;
  }
}

async function start(
  project: TestProject,
  mongo: MongoMemoryServer,
  replicate: Awaited<ReturnType<typeof startFakeReplicate>>,
  track: (child: ChildProcess) => void,
  stopAll: () => Promise<void>
) {
  const port = await freePort();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: DB_NAME,
    REPLICATE_API_URL: `${replicate.url}/v1`,
    REPLICATE_API_TOKEN: "test-token",
    // Never the real (billable) Higgsfield API
    HF_CREDENTIALS: FAKE_HF_CREDENTIALS,
    HIGGSFIELD_API_URL: `${replicate.url}/hf`,
    // Never the real (billable) ElevenLabs API
    ELEVENLABS_API_KEY: FAKE_ELEVENLABS_KEY,
    ELEVENLABS_API_URL: `${replicate.url}/el`,
    BLOB_READ_WRITE_TOKEN: FAKE_BLOB_TOKEN,
    VERCEL_BLOB_API_URL: `${replicate.url}/blob`,
    // Browser side (inlined into the test build only)
    NEXT_PUBLIC_VERCEL_BLOB_API_URL: `${replicate.url}/blob`,
    SESSION_SECRET: "integration-test-secret-0123456789abcdef",
    SUPER_ADMIN_USERNAME: SUPER_ADMIN.username,
    SUPER_ADMIN_PASSWORD: SUPER_ADMIN.password,
    NEXT_TELEMETRY_DISABLED: "1",
  };

  const next = path.join(ROOT, "node_modules/next/dist/bin/next");

  if (!process.env.SKIP_BUILD) {
    const build = spawnSync(process.execPath, [next, "build"], {
      cwd: ROOT,
      env,
      encoding: "utf-8",
    });

    if (build.status !== 0) {
      throw new Error(`next build failed:\n${build.stdout}\n${build.stderr}`);
    }
  }

  let output = "";
  const server = spawn(process.execPath, [next, "start", "-p", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  track(server);
  server.stdout?.on("data", (chunk: Buffer) => (output += chunk));
  server.stderr?.on("data", (chunk: Buffer) => (output += chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(`${baseUrl}/login`, server, () => output);

  project.provide("baseUrl", baseUrl);
  project.provide("replicateUrl", replicate.url);
  project.provide("mongoUri", mongo.getUri());
  project.provide("dbName", DB_NAME);
  project.provide("superAdmin", SUPER_ADMIN);

  return async () => {
    await stopAll();

    // Outputs the tests caused the app to save
    const historyDir = path.join(ROOT, "public/history");
    for (const file of fs.existsSync(historyDir) ? fs.readdirSync(historyDir) : []) {
      if (file.startsWith("test-")) fs.rmSync(path.join(historyDir, file));
    }

    if (process.env.DEBUG_SERVER_LOG) console.log(output);
  };
}
