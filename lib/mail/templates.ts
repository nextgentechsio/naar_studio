import { APP_NAME, copyrightLine } from "@/lib/app-info";
import { LOGO_CID } from "./logo";

// --------------------------------------------------
// EMAIL CONTENT
//
// One branded layout for every email: NAAR black header
// with the wordmark and a cyan rule, a white card, and a
// quiet footer. Built the way email apps need it (tables,
// inline styles, a button Outlook draws too, a hidden
// preview line), with a dark version where the app
// supports it (Apple Mail, Outlook for iOS/Mac).
// --------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Where links in emails point: APP_URL, else the
// production address Vercel gives, else the request's
export function appUrl(fallbackOrigin?: string | null): string | null {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return fallbackOrigin ? fallbackOrigin.replace(/\/$/, "") : null;
}

const text = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");

// --------------------------------------------------
// BRAND
// --------------------------------------------------

const C = {
  page: "#f3f3f1",
  card: "#ffffff",
  ink: "#0d0d0d",
  body: "#3f3f46",
  muted: "#71717a",
  faint: "#a1a1aa",
  line: "#e7e7e4",
  panel: "#f7f7f5",
  cyan: "#2fd6c8",
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

export type Tag = { label: string; tone: "cyan" | "red" | "amber" | "neutral" };

const TAG_COLORS: Record<Tag["tone"], { bg: string; fg: string; dot: string }> = {
  cyan: { bg: "#e6faf8", fg: "#0f6e66", dot: C.cyan },
  red: { bg: "#fdecec", fg: "#b42318", dot: "#e5484d" },
  amber: { bg: "#fff4e0", fg: "#9a5b00", dot: "#f5a524" },
  neutral: { bg: "#f1f1ef", fg: "#52525b", dot: "#a1a1aa" },
};

type Layout = {
  // The grey line inbox lists show after the subject
  preview: string;
  tag?: Tag;
  heading: string;
  // Already-escaped HTML paragraphs
  paragraphs: string[];
  details?: { label: string; value: string }[];
  button?: { label: string; url: string };
  // Already-escaped HTML, under a rule
  note?: string;
  // Why they got it (footer)
  reason: string;
};

function tagHtml(tag: Tag) {
  const color = TAG_COLORS[tag.tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>
<td class="tag" style="background:${color.bg};border-radius:999px;padding:5px 12px 5px 10px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${color.fg};letter-spacing:.02em">
<span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:${color.dot};margin-right:7px;vertical-align:1px"></span>${escapeHtml(tag.label)}
</td></tr></table>`;
}

function detailsHtml(rows: { label: string; value: string }[]) {
  const body = rows
    .map(
      (row, index) => `<tr>
<td class="detail-label" style="padding:${index ? "10px" : "0"} 16px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};white-space:nowrap;vertical-align:top">${escapeHtml(row.label)}</td>
<td class="detail-value" style="padding:${index ? "10px" : "0"} 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink};font-weight:600;word-break:break-word">${row.value}</td>
</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr>
<td class="panel" style="background:${C.panel};border:1px solid ${C.line};border-radius:12px;padding:16px 18px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">${body}</table>
</td></tr></table>`;
}

// A button every email app draws, Outlook for Windows too
function buttonHtml(button: { label: string; url: string }) {
  const url = escapeHtml(button.url);
  const label = escapeHtml(button.label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0"><tr><td>
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="21%" stroke="f" fillcolor="${C.ink}">
<w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${url}" class="button" style="display:inline-block;background:${C.ink};color:#ffffff;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:10px;mso-hide:all">${label}&nbsp;&nbsp;&rarr;</a>
<!--<![endif]-->
</td></tr></table>
<p class="muted" style="margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint}">Button not working? Paste this into your browser:<br>
<a href="${url}" style="color:${C.muted};text-decoration:underline;word-break:break-all">${url}</a></p>`;
}

function layout(options: Layout): string {
  const preview = escapeHtml(options.preview);
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(options.heading)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0;mso-table-rspace:0}
  img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
  @media (max-width:600px){
    .card-pad{padding:28px 24px!important}
    .head-pad{padding:22px 24px!important}
    .h1{font-size:22px!important;line-height:30px!important}
  }
  @media (prefers-color-scheme:dark){
    .page{background:#0a0a0a!important}
    .card{background:#161616!important;border-color:#262626!important}
    .h1,.detail-value{color:#f4f4f3!important}
    .p{color:#c8c8c6!important}
    .muted,.detail-label,.foot{color:#8a8a88!important}
    .panel{background:#1d1d1d!important;border-color:#2a2a2a!important}
    .rule{border-color:#262626!important}
    .button{background:#f4f4f3!important;color:#0d0d0d!important}
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${C.page};word-spacing:normal">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0">${preview}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:${C.page}">
<tr><td align="center" style="padding:40px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

<tr><td class="head-pad" style="background:${C.ink};border-radius:16px 16px 0 0;padding:26px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle"><img src="cid:${LOGO_CID}" width="66" height="24" alt="NAAR" style="display:block;width:66px;height:24px;color:#ffffff;font-family:${FONT};font-size:18px;font-weight:700"></td>
<td align="right" style="vertical-align:middle;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#8f8f8d">Studio</td>
</tr></table>
</td></tr>
<tr><td style="background:${C.cyan};height:3px;line-height:3px;font-size:0">&nbsp;</td></tr>

<tr><td class="card card-pad" style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 16px 16px;padding:40px">
${options.tag ? tagHtml(options.tag) : ""}
<h1 class="h1" style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-.01em;color:${C.ink}">${escapeHtml(options.heading)}</h1>
${options.paragraphs.map((p) => `<p class="p" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body}">${p}</p>`).join("\n")}
${options.details?.length ? detailsHtml(options.details) : ""}
${options.button ? buttonHtml(options.button) : ""}
${
  options.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0"><tr><td class="rule" style="border-top:1px solid ${C.line};padding-top:20px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}"><span class="muted">${options.note}</span></td></tr></table>`
    : ""
}
</td></tr>

<tr><td align="center" style="padding:28px 24px 0">
<p class="foot" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};font-weight:600">${escapeHtml(APP_NAME)} &middot; Internal workspace</p>
<p class="foot" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint}">${options.reason}</p>
<p class="foot" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint}">${escapeHtml(copyrightLine())}</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// --------------------------------------------------
// THE EMAILS
// --------------------------------------------------

const firstLine = (value: string, max = 110) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export function notificationEmail(input: {
  title: string;
  body: string;
  level?: "info" | "important";
  // A budget alert (from the budget checks)
  budget?: boolean;
  url: string | null;
}) {
  const important = input.level === "important";
  const tag: Tag = input.budget
    ? { label: important ? "Budget reached" : "Budget alert", tone: important ? "red" : "amber" }
    : important
      ? { label: "Important", tone: "red" }
      : { label: "Notification", tone: "cyan" };
  return {
    subject: input.title,
    html: layout({
      preview: input.body ? firstLine(input.body) : `New in ${APP_NAME}`,
      tag,
      heading: input.title,
      paragraphs: input.body ? [text(input.body)] : [],
      // (budget alerts go to non-admins too: the studio's
      // home, not the admin-only Budgets page)
      button: input.url ? { label: `Open ${APP_NAME}`, url: input.url } : undefined,
      note: input.budget
        ? "Budgets are set per project by an admin under Admin &rarr; Budgets. New runs are refused once a budget is reached."
        : undefined,
      reason: `You're getting this because it was sent to you in ${escapeHtml(APP_NAME)}. It's also in the bell at the top of the app.`,
    }),
  };
}

export function welcomeEmail(input: {
  name: string;
  username: string;
  email: string;
  createdBy: string;
  signInUrl: string;
  setPasswordUrl: string | null;
}) {
  return {
    subject: `Welcome to ${APP_NAME}`,
    html: layout({
      preview: input.setPasswordUrl
        ? "Your account is ready. Choose your password to get started."
        : "Your account is ready. Sign in to get started.",
      tag: { label: "Welcome", tone: "cyan" },
      heading: `Welcome to ${APP_NAME}, ${input.name}`,
      paragraphs: [
        `${text(input.createdBy)} created an account for you. ${escapeHtml(APP_NAME)} is where the team generates images, video and voice for every project, with every run costed and tracked.`,
        input.setPasswordUrl
          ? "Choose your own password to finish setting up, then sign in with your username or this email address."
          : "Sign in with your username or this email address, and the password your admin gave you.",
      ],
      details: [
        { label: "Username", value: text(input.username) },
        { label: "Email", value: text(input.email) },
        {
          label: "Sign in at",
          value: `<a href="${escapeHtml(input.signInUrl)}" style="color:inherit;text-decoration:underline">${text(input.signInUrl.replace(/^https?:\/\//, ""))}</a>`,
        },
      ],
      button: input.setPasswordUrl
        ? { label: "Choose your password", url: input.setPasswordUrl }
        : { label: "Sign in", url: input.signInUrl },
      note: input.setPasswordUrl
        ? "The link works once and expires in 7 days. You can also sign in with the password your admin gave you, and use &ldquo;Forgot password?&rdquo; on the sign-in page any time."
        : "Forgot it later? Use &ldquo;Forgot password?&rdquo; on the sign-in page.",
      reason: `You're getting this because an account was created for you in ${escapeHtml(APP_NAME)}.`,
    }),
  };
}

export function resetEmail(input: { name: string; username: string; resetUrl: string }) {
  return {
    subject: `Reset your ${APP_NAME} password`,
    html: layout({
      preview: "Use this link within 1 hour to choose a new password.",
      tag: { label: "Security", tone: "neutral" },
      heading: "Reset your password",
      paragraphs: [
        `Hi ${text(input.name)}, we got a request to reset the password for your ${escapeHtml(APP_NAME)} account. Choose a new one with the button below.`,
      ],
      details: [
        { label: "Account", value: text(input.username) },
        { label: "Link expires", value: "In 1 hour, after one use" },
      ],
      button: { label: "Choose a new password", url: input.resetUrl },
      note: "Didn't ask for this? You can ignore this email: your password stays the same. Setting a new password signs your account out on every other device.",
      reason: `You're getting this because a password reset was requested for your ${escapeHtml(APP_NAME)} account.`,
    }),
  };
}
