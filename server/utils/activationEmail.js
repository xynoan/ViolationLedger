import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const hasSmtp =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

const port = Number(process.env.SMTP_PORT) || 587;
const secure = port === 465;

const transporter = hasSmtp
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

function getAppUrl() {
  return (
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

function getLoginUrl() {
  const rawLoginUrl =
    process.env.LOGIN_URL ||
    process.env.APP_LOGIN_URL ||
    '';

  if (rawLoginUrl.trim()) {
    return rawLoginUrl.trim().replace(/\/$/, '');
  }

  return `${getAppUrl()}/login`;
}

function buildLoginEmail({ name, loginUrl }) {
  const displayName = name?.trim() || 'there';
  const subject = 'Your ViolationLedger account is ready';
  const text = `Hi ${displayName},\n\nYour account has been created and is ready to use.\n\nSign in here:\n\n${loginUrl}\n\nIf you did not expect this email, you can ignore it.\n\n- ViolationLedger`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">ViolationLedger</p>
              <h1 style="margin:12px 0 0;font-size:22px;font-weight:600;color:#f8fafc;">Your account is ready</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:#cbd5e1;">Hi ${escapeHtml(displayName)},</p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#cbd5e1;">Your administrator created an account for you. Click the button below to sign in.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0;">
                <tr>
                  <td style="border-radius:8px;background:#16a34a;">
                    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Login</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all;">Or paste this link into your browser:<br/><span style="color:#94a3b8;">${escapeHtml(loginUrl)}</span></p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #334155;">
              <p style="margin:0;font-size:12px;color:#64748b;">If you did not expect this message, you can ignore it.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send account login email with a sign-in link.
 */
export async function sendAccountLoginEmail({ email, name }) {
  const loginUrl = getLoginUrl();
  const { subject, text, html } = buildLoginEmail({ name, loginUrl });
  const mailFrom = process.env.MAIL_FROM || 'ViolationLedger <noreply@localhost>';

  if (transporter) {
    await transporter.sendMail({
      from: mailFrom,
      to: email,
      subject,
      text,
      html,
    });
    console.log('[mail] Login email sent to', email);
  } else {
    console.log('[mail] SMTP not configured - login link (copy for user):');
    console.log('  To:', email);
    console.log('  ', loginUrl);
  }
}
