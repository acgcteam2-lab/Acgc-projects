# Vercel Deployment

## Services

Import the repository as a Vercel project and group the detected applications as Services:

- Frontend service: root directory `.`; framework Vite; build command `npm run build`; output directory `dist`; route `/`.
- Backend service: root directory `backend`; framework Express; start command `npm start`; route `/api`.

The frontend uses the same-origin `/api` base by default, so `VITE_API_BASE_URL` is not needed when both services share this routing.

## Google Cloud Storage

Create two buckets in Google Cloud Storage, preferably in a region eligible for the Cloud Storage free tier:

- `GCS_MEDIA_BUCKET`: product photos, progress photos, review photos, and uploaded documents. Make objects publicly readable to preserve existing direct image/document URLs.
- `GCS_BACKUP_BUCKET`: encrypted backup archives and temporary backup imports. Keep this bucket private; downloads use short-lived signed URLs.

Create a service account with object create, read, list, and delete permissions on both buckets. Generate a JSON key and add the complete JSON as the Vercel secret `GOOGLE_CLOUD_CREDENTIALS_JSON`; add `GOOGLE_CLOUD_PROJECT_ID`, `GCS_MEDIA_BUCKET`, and `GCS_BACKUP_BUCKET`. Do not commit the service-account key.

Configure the media bucket's CORS policy to allow your Vercel site origin, `PUT`, and the `Content-Type` header. The media bucket is public: payment proofs and signed contracts will also be readable by anyone with their URL. For production privacy, move those purposes to a private bucket and add authenticated file-serving before accepting real customer documents.

## Backend Environment Variables

Set these in the backend service's Vercel environment settings:

- `MONGO_URI`
- `JWT_SECRET`
- `BACKUP_ENCRYPTION_KEY` (the existing key is required to read old encrypted backups)
- `CRON_SECRET` (a newly generated long random secret)
- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_CREDENTIALS_JSON`
- `GCS_MEDIA_BUCKET`
- `GCS_BACKUP_BUCKET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `ADMIN_EMAIL`
- `FRONTEND_URL` (the production Vercel site URL)
- `SUPPORT_EMAIL` and `SUPPORT_PHONE` if configured
- `NODE_ENV=production`

Do not set `PORT`; Vercel supplies it. The Vercel Cron job calls `/api/auth/system-settings/cron-backup` daily and authenticates using `CRON_SECRET`.

## Before Production

- Migrate existing database file URLs that point to `localhost:5000/uploads/...`; those files are not automatically copied to Google Cloud Storage.
- Test login, refreshes on nested routes, new uploads, email delivery, backup creation/download/restore, and scheduled backups in a Vercel Preview deployment first.
- Restrict CORS to the deployed site if you later serve the API from a different origin.