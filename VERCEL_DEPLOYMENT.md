# Vercel Deployment

## Services

Import the repository as a Vercel project and group the detected applications as Services:

- Frontend service: root directory `.`; framework Vite; build command `npm run build`; output directory `dist`; route `/`.
- Backend service: root directory `backend`; framework Express; start command `npm start`; route `/api`.

The frontend uses the same-origin `/api` base by default, so `VITE_API_BASE_URL` is not needed when both services share this routing.

## Vercel Blob

Create two Vercel Blob stores and connect both to the backend service:

- A **public** store for product photos, progress photos, review photos, and uploaded documents. Its `BLOB_READ_WRITE_TOKEN` authorizes browser uploads directly to Blob.
- A **private** store for encrypted backup archives and temporary backup imports. Configure its read-write token prefix as `BLOB_PRIVATE_READ_WRITE_TOKEN`; backup downloads use short-lived signed URLs.

Vercel Blob is available on Hobby. Current Hobby included usage is 1 GB storage/month, 10,000 simple operations, 2,000 advanced operations, and 10 GB transfer. Hobby overages are not charged, but Blob access pauses when a limit is exceeded. See [current Blob pricing and quotas](https://vercel.com/docs/vercel-blob/usage-and-pricing).

The media store is public to preserve existing direct URLs, so payment proofs and signed contracts will also be readable by anyone with their URL. Do not use it for real customer documents until private document delivery is implemented.

## Backend Environment Variables

Set these in the backend service's Vercel environment settings:

- `MONGO_URI`
- `JWT_SECRET`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` for server-side product image uploads
- `BACKUP_ENCRYPTION_KEY` (the existing key is required to read old encrypted backups)
- `CRON_SECRET` (a newly generated long random secret)
- `BLOB_READ_WRITE_TOKEN` (provided by the public media store)
- `BLOB_PRIVATE_READ_WRITE_TOKEN` (the private backup store token)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `ADMIN_EMAIL`
- `FRONTEND_URL` (the production Vercel site URL)
- `SUPPORT_EMAIL` and `SUPPORT_PHONE` if configured
- `NODE_ENV=production`

Do not set `PORT`; Vercel supplies it. The Vercel Cron job calls `/api/auth/system-settings/cron-backup` daily and authenticates using `CRON_SECRET`.

## Before Production

- Migrate existing database file URLs that point to `localhost:5000/uploads/...`; those files are not automatically copied to Blob.
- Test login, refreshes on nested routes, new uploads, email delivery, backup creation/download/restore, and scheduled backups in a Vercel Preview deployment first.
- Restrict CORS to the deployed site if you later serve the API from a different origin.