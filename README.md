# 845 Premium Detailing

Customer website + separate password-protected admin + booking system that
syncs to Google Calendar. No npm packages needed - just Node.js 18+.

There are two ways to run the admin (backend):

- **Hosted on GitHub (no computer needed)** - a static admin page on GitHub
  Pages that edits the site by committing to this repo. See
  [Admin hosted on GitHub](#admin-hosted-on-github). This is the everyday
  option once the site is published.
- **Local Node admin** - the full `server.js` admin with password sessions,
  for running on your own machine. See [Run it](#run-it).

## Admin hosted on GitHub

Live at **https://arnavttt.github.io/845-premium-detailing/manage/** once
pushed. It runs entirely in the browser and saves changes by committing to
this repo through the GitHub API, so it is online 24/7 with nothing running on
your computer. A GitHub Action rebuilds the public site automatically after
each save.

**Sign in (one time):**

1. Create a GitHub personal access token: go to
   [github.com/settings/tokens](https://github.com/settings/tokens?type=beta)
   -> **Generate new token (fine-grained)**.
2. Set **Resource owner** to your account, **Repository access** to "Only
   select repositories" -> `845-premium-detailing`, and under **Permissions ->
   Repository permissions** set **Contents: Read and write**. Generate it and
   copy the token (starts with `github_pat_`).
3. Open the admin URL above, paste the token, and sign in. The token is stored
   only in your browser (never committed) and is what authorizes changes -
   it is your login. "Sign out" clears it from the device.

**What it edits:** site content, services & pricing, contact info, and booking
times (slot length, weekly hours, blocked dates, booking window, timezone) -
plus the live booking backend URL under Settings. Bookings themselves live on
your Google Calendar (the Bookings tab links to it).

After you save booking times, the live booking backend picks up the change
within ~5 minutes; other content goes live within ~1 minute once the rebuild
Action finishes.

> Note: the hosted admin and the local Node admin both edit the same data, but
> through different routes (repo commits vs. local files). If you use both,
> `git pull` to keep your local copy in sync.

## Run it

```
node server.js
```

| Site | URL | What it is |
| --- | --- | --- |
| Main site | http://localhost:3000 | Customer site: home, live booking, gallery, contact |
| Admin site | http://localhost:3001 | Owner-only editor (separate site, login required) |

## Admin login

On the very first boot the server generates a random admin password and
prints it in the terminal - write it down. (Set the `ADMIN_PASSWORD` env var
before first boot to choose your own.)

Change it any time in the admin site under **Settings -> Change admin
password**, or from the command line:

```
npm run set-password -- "your-new-password"
```

(Or delete `data/auth.json` and restart - a fresh password is generated.)

## What the admin site controls

- **Site content** - hero text, banner text, the three selling points
- **Services & pricing** - add/remove/edit services (also feeds the booking form)
- **Booking times** - slot length, how far ahead customers can book, open
  hours per weekday, blocked dates (days off / holidays), timezone
- **Bookings** - every booking with contact info, notes, and whether it made
  it onto Google Calendar; deleting one frees the slot and removes the event
- **Contact info** - phone, email, Instagram, area, hours
- **Settings** - Google Calendar connection + password change

Everything saves to JSON files in `data/` and is live on the main site
immediately.

## How booking works

1. Customer picks a service, a date, and one of the open time slots.
2. The backend re-checks the slot is still free, then reserves it. That time
   immediately shows as crossed-out/"Booked" for everyone else on the site.
3. An event is created on your Google Calendar with the customer's name,
   phone, vehicle, and notes.
4. The site and calendar stay synced both ways: open slots are computed
   against the events actually on the calendar, so anything you add there by
   hand (a dentist appointment, a manual booking) crosses that slot out on
   the site too. Deleting an event on the calendar reopens the slot.

Booking rules (slot length, weekly hours, blocked dates, how far out people
can book, timezone) are edited in the admin site under **Booking times**.

## Connect Google Calendar - public site (easiest)

The public GitHub Pages site books through a free Google Apps Script that
lives on your Google account and writes straight to your calendar. No Google
Cloud project, no keys. One-time setup, about 5 minutes:

1. Go to [script.google.com](https://script.google.com) -> **New project**.
2. Paste in the whole contents of [`apps-script/Code.gs`](apps-script/Code.gs)
   (replacing the default code) and save.
3. **Deploy -> New deployment -> Web app**, set **Execute as: Me** and
   **Who has access: Anyone**, then authorize it when asked.
4. Copy the web app URL (ends in `/exec`) into `docs/config.js`:
   `window.BOOKING_API = "https://script.google.com/macros/s/.../exec";`
5. Commit and push - live slot booking is now on the public site.

The script reads its booking rules from this repo's `data/schedule.json` at
request time, so editing **Booking times** in the admin updates the live
booking page with no redeploy. Propagation is gated by GitHub's CDN on that
file (typically seconds, occasionally a minute or two); the script keeps only
a 20-second internal cache so it does not add delay on top.

> If you ever edit `Code.gs` itself, redeploy to push the code change:
> **Deploy -> Manage deployments -> ✏️ edit -> Version: New version -> Deploy**
> (keeps the same `/exec` URL). Editing booking *rules* needs no redeploy.

## Connect Google Calendar - hosted Node backend (optional)

If you later host `server.js` somewhere (Render, Railway, a VPS), connect it
with a service account instead. One-time setup, about 10 minutes:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create
   a project (any name).
2. **APIs & Services -> Library** -> search "Google Calendar API" -> **Enable**.
3. **APIs & Services -> Credentials -> Create credentials -> Service account.**
   Give it any name, skip the optional steps.
4. Open the service account -> **Keys -> Add key -> Create new key -> JSON**.
   A `.json` file downloads.
5. Save that file as `google-service-account.json` in this folder (next to
   `server.js`). Keep it private - it's in `.gitignore` already.
6. In [Google Calendar](https://calendar.google.com), find the calendar you
   want bookings on -> **Settings and sharing -> Share with specific people**
   -> add the service account's email (it looks like
   `name@project.iam.gserviceaccount.com`) with **"Make changes to events"**.
7. Still in calendar settings, scroll to **Integrate calendar** and copy the
   **Calendar ID** (your Gmail address for the primary calendar).
8. In the admin site -> **Settings**, paste the Calendar ID, save, and hit
   **Test Connection**.

Restart the server after adding the key file. From then on every booking shows
up on that calendar automatically.

## Configuration (optional env vars)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Main site port |
| `ADMIN_PORT` | 3001 | Admin site port |
| `ADMIN_PASSWORD` | (see above) | Password used to seed `data/auth.json` on first boot |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `./google-service-account.json` | Path to the service account key |
| `GOOGLE_CALENDAR_ID` | from admin Settings | Overrides the calendar ID |

## Photos

Drop image files in `public/assets/`:

- `hero.jpg` - the big 21:9 photo on the home page
- `gallery/1.jpg` ... `gallery/6.jpg` - gallery photos

Tiles show "Photo coming soon" until the files exist.

## Static public site (GitHub Pages)

GitHub Pages can't run the Node backend, but it can host a static copy of the
customer site. Build it with:

```
npm run build-pages
```

This bakes `data/content.json` into `docs/`, which Pages serves from the
`main` branch. After editing content in the admin, re-run the build, commit,
and push to update the public site.

Live slot booking on the static site needs a backend URL in `docs/config.js`
(`window.BOOKING_API = "..."`): either the Apps Script web app (see "Connect
Google Calendar - public site" above) or a hosted copy of `server.js` (CORS
is already enabled). With no URL set, the Book page falls back to call/text
contact options.

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS...). Run `node server.js`
and expose both ports - or put the two ports behind two domains with a reverse
proxy, e.g. `845premiumdetailing.com -> :3000` and a private
`admin.845premiumdetailing.com -> :3001`. Use HTTPS in production since the
login sends a password. The `data/` folder is the database - back it up and
make sure the host persists it between deploys.

## Project layout

```
server.js     both HTTP servers + all API routes
lib/          store (JSON files), auth (scrypt + sessions),
              calendar (Google service-account JWT), slots (availability)
public/       customer site (port 3000) + manage/ (GitHub-hosted admin)
admin/        local Node admin site (port 3001)
docs/         static GitHub Pages build (npm run build-pages)
.github/      Action that rebuilds docs/ when content or booking times change
apps-script/  Google Apps Script booking backend for the public site
data/         content, schedule, bookings, settings, auth - the "database"
              (bookings/auth/sessions/settings stay local, never in git)
tools/        set-password.js, build-pages.js
```
