// Builds the branded Supabase auth emails into this folder. Run: node supabase/email-templates/make-templates.js
// Paste each .html into Supabase Dashboard → Authentication → Emails → Templates (subject lines are in SUBJECTS below).
// Email clients ignore web fonts and most CSS, so this uses tables, inline styles and system fonts.
const fs = require('fs');
const path = require('path');

const T = {
  confirm: {
    subject: 'Confirm your Kasalo Kape account',
    eyebrow: 'Welcome to the table',
    title: 'Confirm your email, kasalo.',
    body: 'Thanks for signing up. Tap the button to confirm your email and start collecting points: one for every ₱50 you spend.',
    button: 'Confirm my email',
  },
  magic_link: {
    subject: 'Your Kasalo Kape login link',
    eyebrow: 'One-tap login',
    title: 'Here’s your login link.',
    body: 'Tap the button to log in to Kasalo Kape. The link works once and expires in an hour.',
    button: 'Log me in',
  },
  reset_password: {
    subject: 'Reset your Kasalo Kape password',
    eyebrow: 'Password reset',
    title: 'Let’s set a new password.',
    body: 'Someone asked to reset the password for this account. If it was you, tap the button and choose a new one.',
    button: 'Set a new password',
  },
  change_email: {
    subject: 'Confirm your new email for Kasalo Kape',
    eyebrow: 'Email change',
    title: 'Confirm your new email.',
    body: 'Tap the button to start using this address for your Kasalo Kape account.',
    button: 'Confirm new email',
  },
};

const page = t => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4EBDD;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EBDD;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:2px solid #141414;border-radius:24px;">
        <tr><td style="padding:28px 32px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#F2B732;border:2px solid #141414;border-radius:999px;padding:6px 14px;font:700 12px/1 Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#141414;">Kasalo Kape</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <p style="margin:0;font:700 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#A84A2A;">${t.eyebrow}</p>
          <h1 style="margin:10px 0 0;font:400 34px/1.1 Georgia,'Times New Roman',serif;color:#141414;">${t.title}</h1>
          <p style="margin:16px 0 0;font:400 17px/1.55 Georgia,'Times New Roman',serif;color:#141414;">${t.body}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#A84A2A;border:2px solid #141414;border-radius:16px;box-shadow:4px 4px 0 #5B3A8C;">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 28px;font:700 15px/1 Helvetica,Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;">${t.button}</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;">
          <p style="margin:0;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#555555;">Button not working? Copy this link into your browser:<br>
            <a href="{{ .ConfirmationURL }}" style="color:#2456C8;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
          <p style="margin:16px 0 0;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#555555;">Didn’t ask for this? You can ignore this email.</p>
        </td></tr>
        <tr><td style="border-top:2px dashed #5B3A8C;padding:18px 32px;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#555555;">
          Kasalo Kape · Padre Faura St., Ermita, Manila · Open daily until 10PM<br>
          <span style="color:#141414;">ka- (companion) + salo (to share a meal)</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

// Non-ASCII (₱, ’, ·) as HTML entities, so no email client can garble them whatever encoding it assumes.
const ascii = s => s.replace(/[^\x00-\x7F]/g, c => `&#${c.codePointAt(0)};`);
for (const [name, t] of Object.entries(T)) fs.writeFileSync(path.join(__dirname, `${name}.html`), ascii(page(t)));
fs.writeFileSync(path.join(__dirname, 'SUBJECTS.txt'),
  Object.entries(T).map(([n, t]) => `${n}.html  →  subject: ${t.subject}`).join('\n') + '\n');
console.log('wrote', Object.keys(T).map(n => n + '.html').join(', '));
