import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

// Load .env from server directory so SMTP_* are set before we read them.
// (server.js loads .env after its imports, so this module can run before that.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const hasSmtp =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

const port = Number(process.env.SMTP_PORT) || 587;
// Port 465 = implicit TLS (secure: true). Port 587/25 = STARTTLS (secure: false).
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

/**
 * Send activation email. Uses real SMTP if SMTP_HOST/USER/PASS are set;
 * otherwise logs to console (stub mode).
 */
export async function sendActivationEmailStub(user, plainPassword) {
  const mailFrom = process.env.MAIL_FROM || 'LedgerMonitor <noreply@localhost>';
  const subject = 'Account created – LedgerMonitor';
  const text = `Your account has been created.\n\nEmail: ${user.email}\nTemporary password: ${plainPassword}\n\nPlease sign in and change your password.`;

  if (transporter) {
    await transporter.sendMail({
      from: mailFrom,
      to: user.email,
      subject,
      text,
    });
    console.log('Activation email sent to', user.email);
  } else {
    console.log('[email stub] Activation email (no SMTP configured):');
    console.log('  To:', user.email);
    console.log('  Subject:', subject);
    console.log('  Body:', text);
  }
}
