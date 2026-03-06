import nodemailer from 'nodemailer';

const transporter = createTransporter();

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
}

/**
 * Sends an activation email to a new user. Uses SMTP when SMTP_HOST, SMTP_USER, and SMTP_PASS
 * are set in the environment; otherwise logs to console (stub mode).
 * @param {Object} user - User object with at least email and optional name
 * @param {string} [temporaryPassword] - Plain temporary password to include in the email (optional)
 */
export async function sendActivationEmailStub(user, temporaryPassword) {
  if (!user || !user.email) {
    return;
  }

  const name = user.name || user.email;
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@violationledger.local';
  const subject = 'Your ViolationLedger account has been created';
  const passwordLine = temporaryPassword
    ? `\n\nYour temporary password is: ${temporaryPassword}\nPlease log in and change it on first login.`
    : '\n\nPlease use the password set by your administrator and change it on first login.';
  const text =
    `Hello ${name},\n\nYour account has been created in ViolationLedger.${passwordLine}\n\n— ViolationLedger`;

  if (transporter) {
    try {
      await transporter.sendMail({
        from,
        to: user.email,
        subject,
        text,
      });
      console.log('[Email] Activation email sent to:', user.email);
    } catch (err) {
      console.error('[Email] Failed to send activation email:', err.message);
      throw err;
    }
  } else {
    console.log('[EmailStub] Sending activation email:', {
      to: user.email,
      name,
      message: 'Account created. Log in with your temporary password and change it on first login.',
    });
  }
}

export default {
  sendActivationEmailStub,
};
