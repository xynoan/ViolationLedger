export function sendActivationEmailStub(user) {
  if (!user || !user.email) {
    return;
  }

  const name = user.name || user.email;
  // This is a stub only – integrate a real email provider (SMTP, Infobip email, etc.) here.
  console.log('[EmailStub] Sending activation email:', {
    to: user.email,
    name,
    message:
      'Your account has been created in ViolationLedger. Please log in with your temporary password and change it on first login.',
  });
}

export default {
  sendActivationEmailStub,
};

