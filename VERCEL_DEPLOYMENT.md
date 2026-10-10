# Vercel Deployment

## Services

Import the repository as a Vercel project and group the detected applications as Services:

- Frontend service: root directory `.`; framework Vite; build command `npm run build`; output directory `dist`; route `/`.
- Backend service: root directory `backend`; framework Express; start command `npm start`; route `/api`.

The frontend uses the same-origin `/api` base by default, so `VITE_API_BASE_URL` is not needed when both services share this routing.

## Cloudinary Storage

Configure the backend with an active Cloudinary account:

- Product photos are uploaded through the authenticated backend endpoint.
- Reviews, payment proofs, progress media, and contracts use short-lived signed uploads issued by the backend.
- Encrypted backup archives and temporary backup imports use authenticated raw assets.

Media URLs are Cloudinary URLs. Review access rules for payment proofs and signed contracts before storing sensitive customer documents.

## Backend Environment Variables

Set these in the backend service's Vercel environment settings:

- `MONGO_URI`
- `JWT_SECRET`
- `CLOUDINARY_URL` (copied from Cloudinary's API environment variable field), or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
- `BACKUP_ENCRYPTION_KEY` (the existing key is required to read old encrypted backups)
- `CRON_SECRET` (a newly generated long random secret)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `ADMIN_EMAIL`
- `FRONTEND_URL` (the production Vercel site URL)
- `SUPPORT_EMAIL` and `SUPPORT_PHONE` if configured
- `NODE_ENV=production`

Do not set `PORT`; Vercel supplies it. The Vercel Cron job calls `/api/auth/system-settings/cron-backup` daily and authenticates using `CRON_SECRET`.

## Before Production

- Migrate existing database file URLs that point to `localhost:5000/uploads/...`; those files are not automatically copied to Cloudinary.
- Test login, refreshes on nested routes, new uploads, email delivery, backup creation/download/restore, and scheduled backups in a Vercel Preview deployment first.
- Restrict CORS to the deployed site if you later serve the API from a different origin.