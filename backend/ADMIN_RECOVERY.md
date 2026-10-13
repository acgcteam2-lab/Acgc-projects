# Administrator Recovery

Recovery is separate from normal login. It is available only when neither the `Admin` collection nor the legacy `User` collection contains a complete, active administrator with a valid bcrypt password hash. It does not issue a login token and never edits business records.

## Configure

1. Generate values in a private terminal from the `backend` directory:

   ```powershell
   node scripts/generate-admin-recovery-secrets.js <owner-username>
   ```

2. Store the printed values in the backend environment or secret manager. Set `ADMIN_RECOVERY_USERNAME`, `ADMIN_RECOVERY_SECRET`, and `ADMIN_RECOVERY_TOTP_SECRET`. Never put them in frontend/Vite variables, source control, browser storage, tickets, or logs. The recovery secret must be at least 32 characters; the TOTP secret must decode to at least 20 bytes.

3. Add the base32 `ADMIN_RECOVERY_TOTP_SECRET` to an authenticator app using its manual key-entry option. Store recovery values and authenticator access separately from the production database and administrator password.

4. Restart/redeploy the backend, then keep a sealed/offline copy of the recovery procedure with the system owner. Do not test by deleting a production account; validate the flow in an isolated staging database.

## Restore

Open `/admin-recovery`, provide the recovery username, server secret, and current six-digit authenticator code. After verification, enter the replacement administrator profile and a password of 8-128 characters containing uppercase, lowercase, numeric, and symbol characters, then confirm the action. The backend hashes the password through the existing account model, records a recovery audit entry, invalidates the temporary five-minute session, and requires a normal login.

Invalid attempts are rate-limited per source IP (five failures per 15-minute window, followed by a 30-minute lock). TOTP codes can be used once. A valid existing administrator disables recovery. MongoDB connection failures return an unavailable response and never trigger account creation.

## Rotate

Generate a new recovery secret and TOTP seed with the script. Update the backend secret manager and authenticator entry together, redeploy, and securely remove the retired values from old deployment revisions and operator notes. Keep the current values accessible to the authorized owner before removing the old authenticator entry. Never rotate by editing frontend configuration. Recovery can be safely smoke-tested only against a staging database with no valid administrator.

The legacy unauthenticated `POST /api/auth/create-admin` endpoint is disabled. For an initial installation, configure recovery and use this same procedure; do not expose an unauthenticated admin bootstrap route. Trusted server-side provisioning remains available through the existing operational scripts.