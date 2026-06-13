# Security Policy

## Reporting a vulnerability

If you find a security issue in this project, please report it privately to the
repository owner (open a GitHub private security advisory on this repo, or
contact the owner directly). Do not open a public issue for security problems.

## Scope and posture

- Secrets (admin password hash, bookings, sessions, settings, any Google
  service-account key) are kept out of version control via `.gitignore` and are
  **never** committed.
- The hosted admin (`/manage/`) authorizes with a GitHub fine-grained personal
  access token supplied by the owner at sign-in. The token is stored only in the
  owner's browser and is the access credential; it is never committed or shipped.
- The booking backend (Google Apps Script) runs under the owner's Google account
  and writes only to the owner's calendar.
- Secret scanning, push protection, and Dependabot alerts/updates are enabled on
  this repository.

## If a credential is exposed

Rotate it immediately:

- **Admin GitHub token:** revoke at <https://github.com/settings/tokens> and
  issue a new fine-grained token (repo "Contents: Read and write" only).
- **Local Node admin password:** `npm run set-password -- "new-password"` (or
  delete `data/auth.json` and restart to generate a new one).
- **Google Apps Script / calendar:** redeploy the script and/or rotate sharing.

The owner holds an internal remediation report with the full incident-response
playbook (kept out of this repo while it is public).
