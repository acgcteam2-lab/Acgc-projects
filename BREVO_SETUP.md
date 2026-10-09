# Brevo SMTP Setup

The backend already sends mail through Nodemailer and SMTP. Brevo works with the existing mailer; no additional package or source-code credentials are needed.

## Brevo Account

1. In Brevo, verify a sender email address. For production, authenticate your sending domain and configure the SPF/DKIM records Brevo provides.
2. Open **Settings → SMTP & API → SMTP** and create an SMTP key.
3. Copy the SMTP login shown by Brevo. The SMTP password is the SMTP key, not your Brevo account password or API key.

## Local Development

The backend loads `backend/.env` automatically outside production. Keep this file private; it is git-ignored.

Copy the SMTP values from `backend/.env.example` into your existing `backend/.env`, preserving its other settings, then fill in:

```dotenv
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your_brevo_smtp_login
SMTP_PASS=your_brevo_smtp_key
EMAIL_FROM="ACGC Services <your-verified-sender@your-domain.com>"
```

Run the SMTP connection check from the repository root:

```powershell
npm run verify:smtp
```

Then restart the backend so it picks up the new settings. A successful SMTP check confirms the connection and credentials; send a test email through the app to confirm that the sender is authorized and delivery is working.

## Vercel

Add the same five variables to the **backend service** under Vercel Project Settings → Environment Variables. Apply them to Preview first, test a password-reset email, then add them to Production and redeploy. Never put SMTP credentials in `VITE_` variables or frontend settings.

## Common Errors

- **Authentication failed:** confirm you used the SMTP login and SMTP key, not your Brevo account password or API key.
- **Sender rejected:** verify the exact `EMAIL_FROM` address in Brevo, or use an address on an authenticated domain.
- **No email arrives:** check Brevo transactional email logs, recipient spam folders, and the backend logs for SMTP errors.