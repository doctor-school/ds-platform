/** 003 EARS-29, design §13.5: reuse the existing code-email table unchanged. */
export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

interface EmailContent {
  subject: string;
  preheader: string;
  intro: string;
  code?: { value: string; expiry: string };
  paragraphs: string[];
  action?: { label: string; url: string };
  footer: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Content is shared by both parts; code/expiry and the permitted action are optional. */
export function composeEmail(content: EmailContent): EmailMessage {
  const action = content.code ? undefined : content.action;
  const paragraphs = [...content.paragraphs];
  if (content.code) paragraphs.push(content.code.expiry);
  const text = [
    "Здравствуйте!",
    "",
    content.intro + (content.code ? ` ${content.code.value}` : ""),
    "",
    ...paragraphs,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
    "",
    ...content.footer,
  ].join("\n");

  const html = [
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(content.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">`,
    `<tr><td align="center" style="padding:32px 16px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;">`,
    `<tr><td style="padding:32px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#2d84f2;">Doctor.School</td></tr>`,
    `<tr><td style="padding:24px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;">Здравствуйте!</td></tr>`,
    `<tr><td style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;">${escapeHtml(content.intro)}</td></tr>`,
    ...(content.code
      ? [
          `<tr><td align="center" style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:32px;letter-spacing:6px;color:#111827;"><strong>${escapeHtml(content.code.value)}</strong></td></tr>`,
        ]
      : []),
    // Keep the original code instruction and expiry in one row.
    ...(content.code ? [paragraphs.join(" ")] : paragraphs).map(
      (paragraph) =>
        `<tr><td style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;">${escapeHtml(paragraph)}</td></tr>`,
    ),
    ...(action
      ? [
          `<tr><td style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;"><a href="${escapeHtml(action.url)}" style="color:#2d84f2;">${escapeHtml(action.label)}</a></td></tr>`,
        ]
      : []),
    `<tr><td style="padding:24px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;">${content.footer.map(escapeHtml).join("<br><br>")}</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
  ].join("\n");
  return { subject: content.subject, text, html };
}

/** Each transport keeps its configured sender address. */
export function emailSender(address = "noreply@doctor.school"): string {
  const mailbox = /<([^<>]+)>\s*$/.exec(address)?.[1] ?? address;
  return `Doctor.School <${mailbox.trim()}>`;
}
