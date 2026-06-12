# 845 Premium Detailing

Customer website + separate password-protected admin site + booking system that
syncs to Google Calendar. No npm packages needed - just Node.js 18+.

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
2. The server re-checks the slot is still free, then reserves it. That time
   immediately shows as crossed-out/"Booked" for everyone else on the main site.
3. If Google Calendar is connected, an event is created on your calendar with
   the customer's name, phone, vehicle, and notes.
4. Deleting a booking in the admin reopens the slot and deletes the calendar
   event.

A booking always succeeds even if Google Calendar is down or not configured -
the admin Bookings tab shows a "Not on calendar" badge so nothing is lost.

## Connect Google Calendar

One-time setup, about 10 minutes:

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

On the static site the Book page shows call/text contact options by default.
Once the backend is deployed somewhere (see below), put its URL in
`docs/config.js` (`window.BOOKING_API = "https://..."`) and live slot booking
works on the static site too - the API already sends CORS headers.

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
public/       customer site (port 3000)
admin/        admin site (port 3001)
docs/         static GitHub Pages build (npm run build-pages)
data/         content, schedule, bookings, settings, auth - the "database"
              (bookings/auth/sessions/settings stay local, never in git)
tools/        set-password.js, build-pages.js
```
