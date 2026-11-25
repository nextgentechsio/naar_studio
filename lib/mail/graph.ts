import { after } from "next/server";
import { LOGO_CID, LOGO_PNG_BASE64 } from "./logo";

// --------------------------------------------------
// EMAIL through Microsoft Graph (app-only)
//
// The Azure app (MS_GRAPH_TENANT_ID / _CLIENT_ID /
// _CLIENT_SECRET) has the Mail.Send application
// permission and sends as the MAIL_FROM mailbox. Off when
// any of those is missing, or MAIL_ENABLED=false.
// MS_GRAPH_LOGIN_URL / MS_GRAPH_API_URL point the tests
// at a local stand-in.
// --------------------------------------------------

export type Mail = {
  to: string;
  subject: string;
  html: string;
};

type Config = {
  tenant: string;
  clientId: string;
  secret: string;
  from: string;
  loginUrl: string;
  apiUrl: string;
};

function config(): Config | null {
  const env = process.env;
  if (env.MAIL_ENABLED === "false") return null;
  const tenant = env.MS_GRAPH_TENANT_ID?.trim();
  const clientId = env.MS_GRAPH_CLIENT_ID?.trim();
  const secret = env.MS_GRAPH_CLIENT_SECRET?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!tenant || !clientId || !secret || !from) return null;
  return {
    tenant,
    clientId,
    secret,
    from,
    loginUrl: (env.MS_GRAPH_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/$/, ""),
    apiUrl: (env.MS_GRAPH_API_URL || "https://graph.microsoft.com/v1.0").replace(/\/$/, ""),
  };
}

export function mailConfigured(): boolean {
  return config() !== null;
}

// One token per process, renewed a minute before it ends
let cached: { key: string; token: string; expiresAt: number } | null = null;

async function accessToken(cfg: Config): Promise<string> {
  const key = `${cfg.loginUrl}|${cfg.tenant}|${cfg.clientId}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const response = await fetch(`${cfg.loginUrl}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(`Microsoft sign-in failed (${response.status}${data.error ? `: ${data.error}` : ""})`);
  }
  cached = { key, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

// Sends one email. Throws when it can't (callers that
// send in the background log it).
export async function sendMail(mail: Mail): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(cfg);
    const response = await fetch(`${cfg.apiUrl}/users/${encodeURIComponent(cfg.from)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: "HTML", content: mail.html },
          toRecipients: [{ emailAddress: { address: mail.to } }],
          // The logo, inline (cid:), when the email shows it
          ...(mail.html.includes(`cid:${LOGO_CID}`)
            ? {
                attachments: [
                  {
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    name: "naar.png",
                    contentType: "image/png",
                    contentBytes: LOGO_PNG_BASE64,
                    contentId: LOGO_CID,
                    isInline: true,
                  },
                ],
              }
            : {}),
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return;
    // A token that stopped working: get a new one, once
    if (response.status === 401 && attempt === 0) {
      cached = null;
      continue;
    }
    const detail = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new Error(`Sending email failed (${response.status}${detail?.error?.code ? `: ${detail.error.code}` : ""})`);
  }
}

// Sends after the response (outside a request: right away
// in the background). Failures are logged, never thrown.
export function sendMailLater(mails: Mail[] | (() => Promise<Mail[]>), label: string): void {
  if (!mailConfigured()) return;
  const task = async () => {
    const list = typeof mails === "function" ? await mails() : mails;
    for (const mail of list) {
      try {
        await sendMail(mail);
      } catch (error) {
        console.error(`Email (${label}) to one recipient failed:`, error instanceof Error ? error.message : error);
      }
    }
  };
  const run = () => task().catch((error) => console.error(`Email (${label}) failed:`, error));
  try {
    after(run);
  } catch {
    void run();
  }
}
